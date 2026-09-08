const express = require('express');
const crypto = require('crypto');
const https = require('https');

const router = express.Router();

const VOD_VERSION = '2023-01-01';

class BytePlusVodAdapter {
  constructor() {
    let ak = process.env.BYTEPLUS_ACCESS_KEY_ID || '';
    if (ak.length > 0 && !ak.startsWith('AKAP') && /^[A-Za-z0-9+/]+=*$/.test(ak)) {
      try { const d = Buffer.from(ak, 'base64').toString('utf8'); if (d.startsWith('AKAP')) ak = d; } catch (_) {}
    }
    let sk = process.env.BYTEPLUS_SECRET_ACCESS_KEY || '';
    if (sk.length > 0 && /^[A-Za-z0-9+/]+=*$/.test(sk)) {
      try { const d = Buffer.from(sk, 'base64').toString('utf8'); if (d && !d.includes('\uFFFD')) sk = d; } catch (_) {}
    }
    this.ak = ak;
    this.sk = sk;
    this.accountId = process.env.BYTEPLUS_ACCOUNT_ID;
    this.region = 'ap-singapore-1';
    this.serviceName = 'vod';
    this.host = 'vod.byteplusapi.com';
    this.spaceName = process.env.BYTEPLUS_VOD_SPACE_NAME || 'bigstar-drama';
    if (!this.ak || !this.sk) throw new Error('BYTEPLUS_ACCESS_KEY_ID and BYTEPLUS_SECRET_ACCESS_KEY required');
  }

  _hmac(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
  }

  _sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  _uriEncode(str) {
    return encodeURIComponent(str).replace(/[!'(**]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  _sign(query, body) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const XDate = now.getUTCFullYear() + pad(now.getUTCMonth()+1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTSeconds()) + 'Z';
    const YMD = XDate.substring(0, 8);

    const sortedKeys = Object.keys(query).sort();
    const canonicalQuery = sortedKeys.map(k => this._uriEncode(k) + '=' + this._uriEncode(query[k])).join(''');

    const headers = { Host: this.host, 'X-Date': XDate, 'Content-Type': 'application/x-www-form-urlencoded' };
    if (this.accountId) headers['X-Account-Id'] = this.accountId;

    const sortedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaderKeys.map(k => k.toLowerCase() + ':' + headers[k].trim()).join('\n') + '\n';
    const signedHeaders = sortedHeaderKeys.map(k => k.toLowerCase()).join(';');

    const bodyHash = this._sha256(body || '');
    const canonicalRequest = ['GET', '/', canonicalQuery, canonicalHeaders, signedHeaders, bodyHash].join('\n');

    const credentialScope = YMD + '/' + this.region + '/' + this.serviceName + '/request';
    const stringToSign = ['HMAC-SHA256', XDate, credentialScope, this._sha256(canonicalRequest)].join('\n');

    const kDate = this._hmac('AWS4' + this.sk, YMD);
    const kRegion = this._hmac(kDate, this.region);
    const kService = this._hmac(kRegion, this.serviceName);
    const kSigning = this._hmac(kService, 'request');
    const signature = this._hmac(kSigning, stringToSign).toString('hex');

    const authHeader = 'HMAC-SHA256 Credential=' + this.ak + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
    return { headers: Object.assign({}, headers, { Authorization: authHeader ~), canonicalQuery };
  }

  getPlayInfo(vid) {
    const query = { Action: 'GetPlayInfo', Version: VOD_VERSION, Vid: vid };
    const { headers, canonicalQuery } = this._sign(query, '');

    return new Promise((resolve, reject) => {
      const req = https.request({
ЬЭ[YN€\ЛљЬЭ€Y]Щ€	ССU	Л€]€	ЛПЙИ
ИШ[›ЫљXШ[]Y\ћK€XY\њЛ€K™\ИO€В€]]HH	ЙОВ€™\Л›ЫЉ	Щ]IЛИO€]H
ПHКNВ€™\Л›ЫЉ	Щ[™	Л

HO€В€Y€
™\ЛњЭ]\РЫЩHЏH
HВ€™]\›€™Z™XЭ
™]И\њ›ЬЉ	Т	И
И™\ЛњЭ]\РЫЩH
И	О€	И
И]KњЭXњЭљ[™КL
JJNВ€B€]њЫЫЋВ€ћHИњЫЫ€H”УУ‹њ\њЩJ]JNИHШ]Ъ
JHИ™]\›€™Z™XЭ
™]И\њ›ЬЉ	Т”УУ€\њЩHZ[Y€	И
И]KњЭXњЭљ[™КЊ
JJNИB€ЫЫњЭ™\Э[HњЫЫ‹”™\Э[њЫЫ‹њ™\Э[В€Y€
\™\Э[
H™]\›€™Z™XЭ
™]И\њ›ЬЉ	У›И™\Э[€	И
И]KњЭXњЭљ[™КМ
JJNВ€ЫЫњЭ\ЭH™\Э[”^R[™›У\Э™\Э[њ^R[™›У\ЭВ€Y€
[\Э[\Э›[™Э
H™]\›€™Z™XЭ
™]И\њ›ЬЉ	У›И^R[™›У\Э	КJNВ€ЫЫњЭ[™›ИH\ЭМNВ€ЫЫњЭ^U\›H[™›Л“XZ[”^U\›[™›Л›XZ[”^U\›В€Y€
\^U\›
H™]\›€™Z™XЭ
™]И\њ›ЬЉ	У›ИXZ[”^U\›[Ћ€	И
И”УУ‹њЭљ[™ЪYћJ[™›КKњЭXњЭљ[™КМ
JJNВ€™\ЫЫ™JИXZ[”^U\›€^U\›XЪЭ\^U\›€[™›ЛђXЪЭ\^U\›[™›ЛXЪЭ\^U\›\][ЫЋ€[™›Л‘\][Ы€[™›Л™\][Ы€JNВ€JNВ€JNВ€™\K›ЫЉ	Щ\њ›Ь‰ЛHO€™Z™XЭ
™]И\њ›ЬЉ	Ф™\]Y\Э\њ›ЬЋ€	И
ИK›Y\ЬШYЩJJJNВ€™\K™[™

NВ€JNВ€BџB‚›]›ЩY\\ЋВќћHВ€›ЩY\\€H™]Ић]T\Х›ЩY\\Љ
NВ€ЫЫњЫЫK›ЩК	ЦРћ]T\ЧHY\\€ТЛЬXЩN‰Л›ЩY\\‹њЬXЩS[YK	РRО‰Л›ЩY\\‹ZЛњЭXњЭљ[™КLЉH
И	Л‹‹‰Л	ФТИ[Ћ‰Л›ЩY\\‹њЪЛ›[™Э
NВџHШ]Ъ
JHВ€ЫЫњЫЫKќШ\›Љ	ЦРћ]T\ЧHY\\€ЪЪ\Y‰ЛK›Y\ЬШYЩJNВџB‚њ›Э]\‹™Щ]
	ЛЩ\\ЫЩ\ЛО™[XRY	Л\Ю[И
™\K™\КHO€В€ЫЫњЭИ[XRYHH™\Kњ\[\ОВ€ћHВ€ЫЫњЭ\™\Э[H]ШZ]™\Kњљ\ЫXK‰]Y\ћT]Х[њШY™J€СSPХY™\\ЫЩSќ[X™\€‹™\][Ы”ЩXИ‹њМТЩ^H‹ћ]\\ХљY‹ќљY[ФЫЭ\ЩH‚€”“УH‘\\ЫЩH€ТT‘H™[XRY€H	HФ‘T€–H™\\ЫЩSќ[X™\€€TРШ€[XRY€
NВ€ЫЫњЭ[XT™\Э[H]ШZ]™\Kњљ\ЫXK‰]Y\ћT]Х[њШY™J€СSPХ™Y][љY[ФЫЭ\ЩH€”“УH‘[XH€ТT‘HYH	X€[XRY€
NВ€ЫЫњЭY][ЫЭ\ЩHH
[XT™\Э[МH	‰€[XT™\Э[МK™Y][љY[ФЫЭ\ЩJH	ШЫЭYњ›Ыќ	ОВ€ЫЫњЭ™\Э[ИHЧNВ€›Ь€
ЫЫњЭ\Щ€\™\Э[
HВ€ЫЫњЭЫЭ\ЩHH\ќљY[ФЫЭ\ЩHY][ЫЭ\ЩNВ€]ЫЭ\ЩSX™[HЫЭ\ЩNВ€]љY[Х\›Hќ[В€Y€
ЫЭ\ЩHOOH	Шћ]\\ЙИ	‰€›ЩY\\€	‰€\ћ]\\ХљY
HВ€ћHВ€ЫЫњЭ[™›ИH]ШZ]›ЩY\\‹™Щ]^R[™›К\ћ]\\ХљY
NВ€љY[Х\›H[™›Л›XZ[”^U\›В€HШ]Ъ
\њЉHВ€ЫЫњЫЫK™\њ›ЬЉ	ЦРћ]T\ЧH\	И
И\™\\ЫЩSќ[X™\€
И	ИZ[Y‰Л\њ‹›Y\ЬШYЩJNВ€ЫЭ\ЩSX™[H	Шћ]\\И
[XЪКIОВ€B€B€Y€
]љY[Х\›
HљY[Х\›HО‹ЛЭљY[Л›[Ь™\››XYЪXЛЫЫKЙЩ\њМТЩ^_XВ€™\Э[Лњ\Ъ
ИY€\љY\\ЫЩSќ[X™\Ћ€\™\\ЫЩSќ[X™\‹\][Ы”ЩXО€\™\][Ы”ЩXЛљY[Х\›ЫЭ\ЩN€ЫЭ\ЩSX™[JNВ€B€™\ЛљњЫЫЉИЭXШЩ\ЬО€ќYK]N€™\Э[ИJNВ€HШ]Ъ
JHВ€ЫЫњЫЫK™\њ›ЬЉ	ЦРTWHЩ\\ЫЩ\И\њ›ЬЋ‰ЛK›Y\ЬШYЩJNВ€™\ЛњЭ]\КL
KљњЫЫЉИЭXШЩ\ЬО€[ЩK\њ›ЬЋ€K›Y\ЬШYЩHJNВ€BџJNВ‚›[Щ[K™^ЬќИH›Э]\