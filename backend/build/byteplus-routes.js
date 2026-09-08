const express = require('express');
const crypto = require('crypto');
const https = require('https');
const router = express.Router();

// Special chars as character codes to prevent chat/base64 roundtrip corruption.
// The ampersand (chr 38) is the historically problematic one (gets stripped from chat output).
const AMP = String.fromCharCode(38);   // ampersand
const NL = String.fromCharCode(10);    // newline
const SEMI = String.fromCharCode(59);  // semicolon
const COLON = String.fromCharCode(58); // colon

const VOD_VERSION = '2023-01-01';

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
    this.region = 'ap-singapore-1';
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

  // AWS4-HMAC-SHA256 request signing
  _sign(method, path, queryObj, headerObj) {
    const now = new Date();
    // YYYYMMDDTHHMMSSZ (BasicDateTimeFormat per AWS4 spec)
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
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

    const payloadHash = 'UNSIGNED-PAYLOAD';
    const canonicalRequest = [
      method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash
    ].join(NL);

    // 2) String to sign
    const credentialScope = dateStamp + '/' + this.region + '/' + this.serviceName + '/aws4_request';
    const stringToSign = [
      'AWS4-HMAC-SHA256', amzDate, credentialScope, this._sha256(canonicalRequest)
    ].join(NL);

    // 3) Derive signing key
    const kDate = this._hmac('AWS4' + this.sk, dateStamp);
    const kRegion = this._hmac(kDate, this.region);
    const kService = this._hmac(kRegion, this.serviceName);
    const kSigning = this._hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    // 4) Authorization header
    const authorization = 'AWS4-HMAC-SHA256 '
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

      // X-Date is filled by _sign; placeholder for header list
      const headerObj = {
        'Host': this.host,
        'X-Account-Id': this.accountId,
        'X-Date': ''
      };

      const { amzDate, authorization } = this._sign(method, path, queryObj, headerObj);
      headerObj['X-Date'] = amzDate;

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
          'X-Date': amzDate,
          'X-Account-Id': this.accountId,
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

// Init adapter at module load. If it fails, fall back to original videoUrl for all episodes.
let vodAdapter = null;
try {
  vodAdapter = new BytePlusVodAdapter();
  console.log('[BytePlus] Adapter OK, space=' + vodAdapter.spaceName
    + ', account=' + vodAdapter.accountId
    + ', region=' + vodAdapter.region);
} catch (e) {
  console.warn('[BytePlus] Adapter init failed: ' + e.message);
  console.warn('[BytePlus] Will fall back to original videoUrl for all episodes');
}

router.get('/episodes/:dramaId', async (req, res) => {
  const { dramaId } = req.params;
  const prisma = req.prisma;

  if (!prisma) {
    return res.status(500).json({ success: false, error: 'prisma not available on req' });
  }

  try {
    // Only query fields we know exist. Episode table fields:
    //   id, dramaId, episodeNumber, videoUrl, byteplusVid, createdAt, updatedAt
    // (no title / duration / sourceType per current schema)
    const episodes = await prisma.$queryRawUnsafe(
      'SELECT e."episodeNumber", e."videoUrl", e."byteplusVid" '
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
        videoUrl: ep.videoUrl,
        source: 'cloudfront'
      };

      if (ep.byteplusVid && vodAdapter) {
        try {
          const bp = await vodAdapter.getPlayInfo(ep.byteplusVid);
          if (bp && bp.Result && bp.Result.PlayInfoList && bp.Result.PlayInfoList.length > 0) {
            const playInfo = bp.Result.PlayInfoList[0];
            const mainUrl = playInfo.MainPlayUrl || playInfo.PlayUrl;
            if (mainUrl) {
              out.videoUrl = mainUrl;
              out.source = 'byteplus';
            }
          }
        } catch (e) {
          console.warn('[BytePlus] ep ' + ep.episodeNumber + ' getPlayInfo failed: ' + e.message);
          out.source = 'byteplus-fallback';
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

module.exports = router;
