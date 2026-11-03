// CloudFront Functions, JavaScript runtime 2.0. Associate the dedicated KVS.
// Keys: signing:<keyId> -> secret shared ONLY with live-sign.
import cf from 'cloudfront';
import crypto from 'crypto';
const keys = cf.kvs();
const denied = () => ({ statusCode: 403, statusDescription: 'Forbidden', headers: {
  'cache-control': { value: 'private, no-store' }, 'content-type': { value: 'text/plain' },
}, body: 'Unavailable' });
function equal(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
async function handler(event) {
  const request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') return denied();
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
  // Authentication runs BEFORE cache lookup. Stripping the capability only
  // after validation lets viewers share immutable CDN cache objects safely.
  request.uri = '/' + object;
  request.querystring = {};
  delete request.headers.authorization;
  delete request.headers.cookie;
  return request;
}
