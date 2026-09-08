const express = require('express');
const crypto = require('crypto');
const https = require('https');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();

// Special chars as character codes to prevent chat/base64 roundtrip corruption.
// The ampersand (chr 38) is the historically problematic one (gets stripped from chat output).
const AMP = String.fromCharCode(38);   // ampersand
const NL = String.fromCharCode(10);    // newline
const SEMI = String.fromCharCode(59);  // semicolon
const COLON = String.fromCharCode(58); // colon

const VOD_VERSION = '2023-01-01';
const S3_BUCKET = process.env.S3_BUCKET || 'mordernmagic-drama-media';
const S3_SIGN_TTL = 604800; // 7 days, matching src/index.ts play-auth
// sha256 of empty string — used for GET requests with no body
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
// Content-Type required by BytePlus signing (RFC 3986 form encoding, even for GET)
const CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=utf-8';

// ===== S3 client (same config as src/index.ts) =====
let s3 = null;
try {
  s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  });
  console.log('[S3] Client OK, bucket=' + S3_BUCKET + ', region=' + (process.env.AWS_REGION || 'us-east-1'));
} catch (e) {
  console.warn('[S3] Client init failed: ' + e.message);
}

// ===== BytePlus VOD adapter (hand-written HMAC-SHA256 signing) =====
class BytePlusVodAdapter {
  constructor() {
    const ak = process.env.BYTEPLUS_ACCESS_KEY_ID || '';
    const skB64 = process.env.BYTEPLUS_SECRET_ACCESS_KEY || '';
    const accountId = process.env.BYTEPLUS_ACCOUNT_ID || '';
    const spaceName = process.env.BYTEPLUS_SPACE_NAME || '';

    if (!ak || !skB64 || !accountId || !spaceName) {
      throw new Error(
        'Missing BytePlus env vars: AK=' + (ak ? 'set' : 'MISSING') +
        ', SK=' + (skB64 ? 'set' : 'MISSING') +
        ', AccountId=' + (accountId || 'MISSING') +
        ', SpaceName=' + (spaceName || 'MISSING')
      );
    }

    // SK is base64-encoded for safe transport. Decode it.
    let sk;
    try {
      sk = Buffer.from(skB64, 'base64').toString('utf8');
      if (!sk || sk.length < 16) {
        sk = skB64; // not actually base64, use as-is
      }
    } catch (e) {
      sk = skB64;
    }

    this.ak = ak;
    this.sk = sk;
    this.accountId = accountId;
    this.spaceName = spaceName;
    // Region from env (override BYTEPLUS_REGION if your space is in ap-southeast-1 / Johor)
    this.region = process.env.BYTEPLUS_REGION || 'ap-singapore-1';
    this.serviceName = 'vod';
    this.host = 'vod.byteplusapi.com';
  }

  _hmac(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
  }

  _sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // AWS4 uri-encoding (close to encodeURIComponent but stricter)
  _uriEncode(str) {
    return encodeURIComponent(str)
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/\*/g, '%2A');
  }

  // BytePlus OpenAPI HMAC-SHA256 request signing
  // (NOT AWS4-HMAC-SHA256 — BytePlus uses their own algorithm, see
  //  https://docs.byteplus.com/en/docs/byteplus-platform/reference-how-to-calculate-a-signature)
  //
  // Differences from AWS4:
  //   - Algorithm name: 'HMAC-SHA256' (not 'AWS4-HMAC-SHA256')
  //   - CredentialScope terminal: 'request' (not 'aws4_request')
  //   - kSecret = SK directly (not 'AWS4' + SK)
  //   - kSigning last step: HMAC(kService, 'request') (not 'aws4_request')
  //   - Required signed headers: content-type, host, x-content-sha256, x-date
  //     (X-Account-Id is NOT a BytePlus OpenAPI header — drop it)
  //   - x-content-sha256 is sha256 of (empty) body for GET
  //
  // amzDate must be passed in (not generated here) so the same value can be
  // placed in the actual request headers AND in the canonical headers used
  // for signing. If the two drift, signature validation fails.
  _sign(method, path, queryObj, headerObj, amzDate) {
    if (!amzDate) {
      amzDate = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '');
    }
    const dateStamp = amzDate.slice(0, 8);

    // 1) Canonical request
    const sortedQueryKeys = Object.keys(queryObj).sort();
    const canonicalQuery = sortedQueryKeys
      .map(k => this._uriEncode(k) + '=' + this._uriEncode(queryObj[k]))
      .join(AMP);

    const sortedHeaderKeys = Object.keys(headerObj).sort();
    const canonicalHeaders = sortedHeaderKeys
      .map(k => k.toLowerCase() + COLON + headerObj[k] + NL)
      .join('');
    const signedHeaders = sortedHeaderKeys.map(k => k.toLowerCase()).join(SEMI);

    const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // sha256('') for GET
    const canonicalRequest = [
      method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash
    ].join(NL);

    // 2) String to sign
    const credentialScope = dateStamp + '/' + this.region + '/' + this.serviceName + '/request';
    const stringToSign = [
      'HMAC-SHA256', amzDate, credentialScope, this._sha256(canonicalRequest)
    ].join(NL);

    // 3) Derive signing key (BytePlus variant, NOT AWS4)
    const kDate = this._hmac(this.sk, dateStamp);
    const kRegion = this._hmac(kDate, this.region);
    const kService = this._hmac(kRegion, this.serviceName);
    const kSigning = this._hmac(kService, 'request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    // 4) Authorization header
    const authorization = 'HMAC-SHA256 '
      + 'Credential=' + this.ak + '/' + credentialScope + ', '
      + 'SignedHeaders=' + signedHeaders + ', '
      + 'Signature=' + signature;

    return { amzDate, authorization };
  }

  getPlayInfo(vid) {
    return new Promise((resolve, reject) => {
      const queryObj = {
        Action: 'GetPlayInfo',
        Version: VOD_VERSION,
        SpaceName: this.spaceName,
        Vid: vid
      };
      const method = 'GET';
      const path = '/';

      // Pre-compute amzDate so the same value goes into headerObj (signed)
      // AND into the actual request headers (sent on the wire). If they
      // drift, AWS4 signature validation fails with InvalidAuthorization.
      const now = new Date();
      const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');

      // BytePlus OpenAPI signed-headers: content-type + host + x-content-sha256 + x-date
      // (X-Account-Id is NOT part of the signing block — sending it unsigned)
      const headerObj = {
        'Host': this.host,
        'Content-Type': CONTENT_TYPE,
        'X-Content-Sha256': EMPTY_BODY_SHA256,
        'X-Date': amzDate
      };

      const { authorization } = this._sign(method, path, queryObj, headerObj, amzDate);

      const queryStr = Object.keys(queryObj).sort()
        .map(k => this._uriEncode(k) + '=' + this._uriEncode(queryObj[k]))
        .join(AMP);

      const options = {
        hostname: this.host,
        port: 443,
        path: path + '?' + queryStr,
        method: method,
        headers: {
          'Host': this.host,
          'Content-Type': CONTENT_TYPE,
          'X-Content-Sha256': EMPTY_BODY_SHA256,
          'X-Date': amzDate,
          'Authorization': authorization
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.ResponseMetadata && json.ResponseMetadata.Error) {
              const err = json.ResponseMetadata.Error;
              reject(new Error('BytePlus API error: ' + err.Code + ' - ' + err.Message));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error('BytePlus response parse error: ' + e.message + ', data: ' + data.slice(0, 500)));
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.setTimeout(15000, () => { req.destroy(new Error('BytePlus request timeout')); });
      req.end();
    });
  }
}

// Init BytePlus adapter at module load. If it fails, all episodes fall back to S3 presigned.
let vodAdapter = null;
try {
  vodAdapter = new BytePlusVodAdapter();
  console.log('[BytePlus] Adapter OK, space=' + vodAdapter.spaceName
    + ', account=' + vodAdapter.accountId
    + ', region=' + vodAdapter.region);
} catch (e) {
  console.warn('[BytePlus] Adapter init failed: ' + e.message);
  console.warn('[BytePlus] Will fall back to S3 presigned URL for all episodes');
}

// ===== Route: list episodes for a drama, with BytePlus or S3 fallback =====
router.get('/episodes/:dramaId', async (req, res) => {
  const { dramaId } = req.params;
  const prisma = req.prisma;

  if (!prisma) {
    return res.status(500).json({ success: false, error: 'prisma not available on req' });
  }

  try {
    // Episode table fields (from schema.prisma): id, dramaId, episodeNumber, s3Key, durationSec, createdAt
    // byteplusVid was added later via ALTER TABLE
    const episodes = await prisma.$queryRawUnsafe(
      'SELECT e."episodeNumber", e."s3Key", e."byteplusVid" '
      + 'FROM "Episode" e '
      + 'WHERE e."dramaId" = $1 '
      + 'ORDER BY e."episodeNumber" ASC',
      dramaId
    );

    if (!episodes || episodes.length === 0) {
      return res.json({ success: true, episodes: [], message: 'No episodes found' });
    }

    const enriched = await Promise.all(episodes.map(async (ep) => {
      const out = {
        episodeNumber: ep.episodeNumber,
        videoUrl: null,
        source: 'pending'
      };

      // 1) Try BytePlus first (only if byteplusVid is set and adapter is ready)
      if (ep.byteplusVid && vodAdapter) {
        try {
          const bp = await vodAdapter.getPlayInfo(ep.byteplusVid);
          if (bp && bp.Result && bp.Result.PlayInfoList && bp.Result.PlayInfoList.length > 0) {
            const playInfo = bp.Result.PlayInfoList[0];
            const mainUrl = playInfo.MainPlayUrl || playInfo.PlayUrl;
            if (mainUrl) {
              out.videoUrl = mainUrl;
              out.source = 'byteplus';
              return out;
            }
          }
        } catch (e) {
          console.warn('[BytePlus] ep ' + ep.episodeNumber + ' getPlayInfo failed: ' + e.message);
        }
      }

      // 2) Fall back to S3 presigned URL (7 days, same as play-auth route)
      if (ep.s3Key && s3) {
        try {
          const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: ep.s3Key });
          const signedUrl = await getSignedUrl(s3, cmd, { expiresIn: S3_SIGN_TTL });
          out.videoUrl = signedUrl;
          out.source = 's3-presigned';
        } catch (e) {
          console.warn('[S3] ep ' + ep.episodeNumber + ' presign failed: ' + e.message);
          out.source = 's3-failed';
        }
      }

      return out;
    }));

    res.json({ success: true, episodes: enriched });
  } catch (e) {
    console.error('[episodes] error: ' + e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ===== Debug endpoint: list all dramas + episode byteplusVid fill status =====
// Purpose: from Railway logs/curl, identify dramaId and see which episodes
// have byteplusVid populated (i.e. already uploaded to BytePlus VOD).
// Uses an internal PrismaClient (the byteplusVid column is not in schema.prisma,
// so we go through raw SQL).
const debugPrisma = new PrismaClient();

router.get('/_debug/dramas', async (req, res) => {
  try {
    const rows = await debugPrisma.$queryRawUnsafe(
      'SELECT d."id", d."slug", d."title", '
      + 'COUNT(e."id")::int AS ep_total, '
      + 'COUNT(e."byteplusVid")::int AS ep_with_vid, '
      + 'COUNT(CASE WHEN e."s3Key" IS NOT NULL THEN 1 END)::int AS ep_with_s3 '
      + 'FROM "Drama" d LEFT JOIN "Episode" e ON e."dramaId" = d."id" '
      + 'GROUP BY d."id", d."slug", d."title" '
      + 'ORDER BY d."createdAt" ASC NULLS LAST'
    );
    res.json({ success: true, dramas: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ===== Startup log: print the same table once, so the operator can find
// dramaIds and byteplusVid fill status from Railway boot logs alone.
setImmediate(async () => {
  try {
    const rows = await debugPrisma.$queryRawUnsafe(
      'SELECT d."id", d."slug", d."title", '
      + 'COUNT(e."id")::int AS ep_total, '
      + 'COUNT(e."byteplusVid")::int AS ep_with_vid, '
      + 'COUNT(CASE WHEN e."s3Key" IS NOT NULL THEN 1 END)::int AS ep_with_s3 '
      + 'FROM "Drama" d LEFT JOIN "Episode" e ON e."dramaId" = d."id" '
      + 'GROUP BY d."id", d."slug", d."title" '
      + 'ORDER BY d."createdAt" ASC NULLS LAST'
    );
    console.log('[DramaDump] === start ===');
    for (const r of rows) {
      console.log(
        '[DramaDump] id=' + r.id
        + ' slug=' + r.slug
        + ' title=' + r.title
        + ' ep=' + r.ep_total
        + ' withVid=' + r.ep_with_vid
        + ' withS3=' + r.ep_with_s3
      );
    }
    console.log('[DramaDump] === end (' + rows.length + ' dramas) ===');
  } catch (e) {
    console.warn('[DramaDump] failed: ' + e.message);
  }
});

module.exports = router;
