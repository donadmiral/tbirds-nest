import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest, type RequestOptions as HttpsOptions } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { isIP } from 'node:net';
import { Buffer } from 'node:buffer';
import { choosePublicAddress, plainHostname, previewUrl, PreviewError, type Address } from './networkPolicy.ts';

export type FetchKind = 'html' | 'image';
export type PinnedResult = { status: number; headers: Record<string,string>; bytes: Uint8Array };
export type SafeResult = PinnedResult & { url: string };
type PinnedRequest = (url: URL, address: Address, kind: FetchKind, signal: AbortSignal) => Promise<PinnedResult>;
const MAX_BYTES = { html: 300_000, image: 2_000_000 };

export function pinnedOptions(url: URL, address: Address, signal: AbortSignal): HttpsOptions {
  const host = plainHostname(url);
  return {
    protocol: url.protocol,
    hostname: address.address,
    family: address.family,
    port: url.protocol === 'https:' ? 443 : 80,
    path: url.pathname + url.search,
    method: 'GET', agent: false, signal, maxHeaderSize: 16_384,
    servername: isIP(host) ? undefined : host,
    rejectUnauthorized: true,
    checkServerIdentity: (_name, certificate) => checkServerIdentity(host,certificate),
    headers: {
      Host: url.host, Accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8',
      'Accept-Encoding': 'identity', Connection: 'close',
      'User-Agent': 'PlatinumCirclesPreview/2.0 (+https://platinumcircles.app)',
    },
  };
}

// The Node implementation supports real stream fixtures. The hosted entrypoint
// injects the native Deno transport because its older node:https shim ignores SNI.
export function createPinnedRequest(requests = { http: httpRequest, https: httpsRequest }): PinnedRequest {
  return (url,address,kind,signal) => new Promise((resolve,reject) => {
    if (signal.aborted) { reject(new PreviewError('timeout')); return; }
    let settled = false, response: IncomingMessage | undefined;
    const chunks: Uint8Array[] = []; let size = 0;
    const headers: Record<string,string> = {};
    const done = (error?: Error) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort',abort);
      if (error) reject(error);
      else resolve({ status: response!.statusCode || 0, headers, bytes: Buffer.concat(chunks,size) });
      response?.destroy(); request.destroy();
    };
    const abort = () => done(new PreviewError('timeout'));
    const send = url.protocol === 'https:' ? requests.https : requests.http;
    const request = send(pinnedOptions(url,address,signal) as RequestOptions, res => {
      response = res;
      for (const key of ['location','content-type','content-encoding']) {
        const value = res.headers[key];
        if (Array.isArray(value)) { done(new PreviewError('upstream')); return; }
        if (value) headers[key] = value;
      }
      if ([301,302,303,307,308].includes(res.statusCode || 0)) { done(); return; }
      if (res.statusCode !== 200 || (headers['content-encoding'] && headers['content-encoding'].toLowerCase() !== 'identity')) { done(new PreviewError('upstream')); return; }
      const mime = (headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (kind === 'html' ? !['text/html','application/xhtml+xml'].includes(mime) : !['image/jpeg','image/png','image/gif','image/webp','image/avif'].includes(mime)) { done(new PreviewError('upstream')); return; }
      res.on('data',(chunk: Buffer) => {
        if (settled) return;
        const remaining = MAX_BYTES[kind] - size;
        if (kind === 'image' && chunk.byteLength > remaining) { done(new PreviewError('too_large')); return; }
        const part = chunk.subarray(0,remaining);chunks.push(part);size += part.byteLength;
        if (kind === 'html' && size >= MAX_BYTES.html) done();
      });
      res.once('end',() => done());
      res.once('aborted',() => done(new PreviewError('upstream')));
      res.once('error',() => done(new PreviewError('upstream')));
    });
    request.once('error',() => done(new PreviewError(signal.aborted ? 'timeout' : 'upstream')));
    signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted) abort();
    else request.end();
  });
}

async function withinDeadline<T>(promise: Promise<T>,signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new PreviewError('timeout');
  let abort: () => void = () => {};
  try {
    return await Promise.race([promise,new Promise<T>((_,reject) => {
      abort = () => reject(new PreviewError('timeout'));
      signal.addEventListener('abort',abort,{once:true});
    })]);
  } finally { signal.removeEventListener('abort',abort); }
}

export function createSafeFetch(deps: {
  resolve?: (host: string) => Promise<Address[]>;
  request?: PinnedRequest;
  timeoutMs?: number;
} = {}) {
  const resolve = deps.resolve || (host => lookup(host,{all:true,verbatim:true}));
  const request = deps.request || createPinnedRequest();
  return async (raw: string,kind: FetchKind,callerSignal?: AbortSignal): Promise<SafeResult> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    callerSignal?.addEventListener('abort',abort,{once:true});
    if (callerSignal?.aborted) abort();
    const timer = setTimeout(abort,deps.timeoutMs ?? 8_000);
    try {
      let url = previewUrl(raw);
      const seen = new Set<string>();
      for(let redirects = 0; redirects <= 4; redirects++) {
        if (seen.has(url.href)) throw new PreviewError('upstream');
        seen.add(url.href);
        const host = plainHostname(url);
        const records = isIP(host) ? [{address:host,family:isIP(host)}] : await withinDeadline(resolve(host),controller.signal);
        const address = choosePublicAddress(records);
        const result = await withinDeadline(request(url,address,kind,controller.signal),controller.signal);
        if (![301,302,303,307,308].includes(result.status)) return {...result,url:url.href};
        const location = result.headers.location;
        if (!location || redirects === 4) throw new PreviewError('upstream');
        let next: URL;
        try { next = previewUrl(new URL(location,url).href); } catch { throw new PreviewError('blocked'); }
        if (url.protocol === 'https:' && next.protocol !== 'https:') throw new PreviewError('blocked');
        url = next;
      }
      throw new PreviewError('upstream');
    } finally { clearTimeout(timer);callerSignal?.removeEventListener('abort',abort); }
  };
}

export function rasterMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)) return 'image/png';
  const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.subarray(start,end));
  if (['GIF87a','GIF89a'].includes(ascii(0,6))) return 'image/gif';
  if (ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP') return 'image/webp';
  if (ascii(4,8)==='ftyp' && ['avif','avis'].includes(ascii(8,12))) return 'image/avif';
  return null;
}
