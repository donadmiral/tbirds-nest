// CloudFront Functions, JavaScript runtime 2.0. Associate the dedicated KVS.
// Keys: signing:<keyId> -> secret shared ONLY with live-sign.
import cf from 'cloudfront';
const crypto = require('crypto');
const keys = cf.kvs();
const denied = () => ({ statusCode: 403, statusDescription: 'Forbidden', headers: {
  'cache-control': { value: 'private, no-store' }, 'content-type': { value: 'text/plain' },
  'access-control-allow-origin': { value: '*' }, 'referrer-policy': { value: 'no-referrer' },
}, body: 'Unavailable' });
function equal(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
async function handler(event) {
  const request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') return denied();
  const match = request.uri.match(/^\/_live\/([a-z0-9_-]{1,16})\.(\d{10})\.([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.([a-f0-9]{64})\/(live\/[a-zA-Z0-9_.\/-]{1,320})$/);
  if (!match) return denied();
  const expires = Number(match[2]), now = Math.floor(Date.now() / 1000), object = match[6];
  if (expires <= now || expires > now + 120 || object.indexOf('live/' + match[3] + '/' + match[4] + '/') !== 0
    || object.indexOf('..') !== -1 || object.indexOf('//') !== -1 || !/\.(m3u8|ts|m4s|mp4|vtt)$/.test(object)) return denied();
  try {
    const secret = await keys.get('signing:' + match[1]); if (!secret || secret.length < 32) return denied();
    const signed = 'pc-live-v1.' + match[1] + '.' + match[2] + '.' + match[3] + '.' + match[4];
    const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
    if (!equal(expected, match[5])) return denied();
  } catch (_) { return denied(); }
  // Preflights are answered here only after the same capability check. They
  // never reach S3, and cannot authorize a write or a credentialed request.
  if (request.method === 'OPTIONS') {
    const method = request.headers['access-control-request-method'];
    const requested = request.headers['access-control-request-headers'];
    if (!method || (method.value !== 'GET' && method.value !== 'HEAD')) return denied();
    const names = requested ? requested.value.toLowerCase().split(',') : [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i].trim();
      if (name !== 'range' && name !== 'origin' && name !== 'accept') return denied();
    }
    return { statusCode: 204, statusDescription: 'No Content', headers: {
      'access-control-allow-origin': { value: '*' },
      'access-control-allow-methods': { value: 'GET, HEAD, OPTIONS' },
      'access-control-allow-headers': { value: 'Range, Origin, Accept' },
      'access-control-max-age': { value: '60' },
      'cache-control': { value: 'private, no-store' },
      'referrer-policy': { value: 'no-referrer' },
    } };
  }
  // Authentication runs BEFORE cache lookup. Stripping the capability only
  // after validation lets viewers share immutable CDN cache objects safely.
  request.uri = '/' + object;
  request.querystring = {};
  delete request.headers.authorization;
  delete request.headers.cookie;
  return request;
}
