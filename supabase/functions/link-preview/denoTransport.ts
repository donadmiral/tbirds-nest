import { plainHostname, PreviewError, type Address } from './networkPolicy.ts';
import type { FetchKind, PinnedResult } from './transport.ts';

type Connection = Pick<Deno.Conn, 'read' | 'write' | 'close'>;
type TlsConnection = Connection & { handshake(): Promise<unknown> };
type Connector = {
  connect(options: {hostname: string; port: number}): Promise<Connection>;
  startTls(connection: Connection, options: {hostname: string; alpnProtocols: string[]}): Promise<TlsConnection>;
};
const MAX_BYTES = {html: 300_000, image: 2_000_000};
const MAX_HEADERS = 16_384;
const encoder = new TextEncoder();
const redirects = new Set([301, 302, 303, 307, 308]);
const defaultConnector: Connector = {
  connect: options => Deno.connect(options),
  startTls: (connection, options) => Deno.startTls(connection as Deno.TcpConn, options),
};

// A single bounded buffer is shared by the HTTP head and body parsers. No
// response-controlled allocation occurs before its length has been checked.
class Reader {
  private buffer = new Uint8Array(16_384);
  private offset = 0;
  private available = 0;
  constructor(private connection: Connection) {}
  async some(maximum: number): Promise<Uint8Array | null> {
    if (this.offset === this.available) {
      const size = await this.connection.read(this.buffer);
      if (size === null) return null;
      if (size <= 0) throw new PreviewError('upstream');
      this.offset = 0; this.available = size;
    }
    const end = Math.min(this.available, this.offset + maximum);
    const bytes = this.buffer.slice(this.offset, end); this.offset = end;
    return bytes;
  }
  async line(maximum: number): Promise<string> {
    let result = '', carriage = false;
    for (;;) {
      const part = await this.some(1);
      if (!part) throw new PreviewError('upstream');
      const byte = part[0];
      if (carriage) {
        if (byte !== 10) throw new PreviewError('upstream');
        return result;
      }
      if (byte === 13) carriage = true;
      else {
        if (byte === 10 || result.length >= maximum) throw new PreviewError('upstream');
        result += String.fromCharCode(byte);
      }
    }
  }
}

async function readHead(reader: Reader) {
  let used = 0;
  const line = async () => {
    const value = await reader.line(MAX_HEADERS - used);
    used += value.length + 2;
    if (used > MAX_HEADERS) throw new PreviewError('upstream');
    return value;
  };
  // Informational responses are allowed, with one shared byte/count budget.
  for (let interim = 0; interim < 4; interim++) {
    const status = (await line()).match(/^HTTP\/1\.[01] ([1-5]\d\d)(?:[ \t][\x20-\x7e]*)?$/);
    if (!status) throw new PreviewError('upstream');
    const headers: Record<string, string> = Object.create(null);
    let count = 0;
    for (;;) {
      const value = await line(); if (!value) break;
      if (++count > 100) throw new PreviewError('upstream');
      const match = value.match(/^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([\x09\x20-\x7e\x80-\xff]*)$/);
      if (!match) throw new PreviewError('upstream');
      const name = match[1].toLowerCase();
      if (['location', 'content-type', 'content-encoding', 'content-length', 'transfer-encoding'].includes(name)) {
        if (name in headers) throw new PreviewError('upstream');
        headers[name] = match[2].trim();
      }
    }
    const code = Number(status[1]);
    if (code >= 200) return {status: code, headers};
    if (code === 101 || headers['content-length'] || headers['transfer-encoding']) throw new PreviewError('upstream');
  }
  throw new PreviewError('upstream');
}

async function readBody(reader: Reader, headers: Record<string, string>, kind: FetchKind): Promise<Uint8Array> {
  const limit = MAX_BYTES[kind];
  const length = headers['content-length'], transfer = headers['transfer-encoding'];
  if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new PreviewError('upstream');
  if (transfer !== undefined && (transfer.toLowerCase() !== 'chunked' || length !== undefined)) throw new PreviewError('upstream');
  if (kind === 'image' && length !== undefined && Number(length) > limit) throw new PreviewError('too_large');
  const chunks: Uint8Array[] = []; let size = 0;
  const add = (bytes: Uint8Array) => {
    if (kind === 'image' && size + bytes.length > limit) throw new PreviewError('too_large');
    const part = bytes.subarray(0, limit - size); chunks.push(part); size += part.length;
  };
  const exact = async (count: number) => {
    while (count > 0) {
      if (kind === 'html' && size >= limit) return false;
      const part = await reader.some(Math.min(count, limit - size + (kind === 'image' ? 1 : 0)));
      if (!part) throw new PreviewError('upstream');
      add(part); count -= part.length;
    }
    return true;
  };
  if (transfer !== undefined) {
    let framing = 0;
    for (;;) {
      const line = await reader.line(1024); framing += line.length + 2;
      // The decoded body AND its framing are bounded. Tiny chunks cannot force
      // unbounded parser work before the absolute network deadline fires.
      if (framing > 64_000 || !/^[0-9a-fA-F]{1,16}(?:;[\x20-\x7e]*)?$/.test(line)) throw new PreviewError('upstream');
      const count = Number.parseInt(line.split(';')[0], 16);
      if (!Number.isSafeInteger(count)) throw new PreviewError('upstream');
      if (count === 0) {
        let trailers = 0;
        for (;;) {
          const trailer = await reader.line(MAX_HEADERS - trailers);
          trailers += trailer.length + 2;
          if (trailers > MAX_HEADERS) throw new PreviewError('upstream');
          if (!trailer) break;
          if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+:[\x09\x20-\x7e\x80-\xff]*$/.test(trailer)) throw new PreviewError('upstream');
          if (/^(content-length|transfer-encoding|content-type|content-encoding|location):/i.test(trailer)) throw new PreviewError('upstream');
        }
        break;
      }
      if (kind === 'image' && count > limit - size) throw new PreviewError('too_large');
      if (!await exact(count) || (kind === 'html' && size >= limit)) break;
      if (await reader.line(0) !== '') throw new PreviewError('upstream');
      framing += 2;
    }
  } else if (length !== undefined) {
    await exact(Number(length));
  } else {
    for (;;) {
      if (kind === 'html' && size >= limit) break;
      const part = await reader.some(limit - size + (kind === 'image' ? 1 : 0));
      if (!part) break;
      add(part);
    }
  }
  const output = new Uint8Array(size); let offset = 0;
  for (const part of chunks) {output.set(part, offset); offset += part.length;}
  return output;
}

// Deno 2.1's node:https shim ignores the separate TLS servername. Use its native
// TCP/TLS APIs so the socket destination stays pinned to the validated IP while
// certificate validation and SNI use the original hostname. No insecure retry.
export function createDenoPinnedRequest(connector: Connector = defaultConnector) {
  return async (url: URL, address: Address, kind: FetchKind, signal: AbortSignal): Promise<PinnedResult> => {
    let connection: Connection | undefined, closed = false;
    const close = () => {closed = true; try {connection?.close();} catch { /* already closed */ }};
    const check = () => {if (closed || signal.aborted) throw new PreviewError('timeout');};
    const retain = <T extends Connection>(value: T): T => {
      if (closed || signal.aborted) {try {value.close();} catch { /* already closed */ } throw new PreviewError('timeout');}
      connection = value; return value;
    };
    signal.addEventListener('abort', close, {once: true});
    try {
      check();
      await connector.connect({hostname: address.address, port: url.protocol === 'https:' ? 443 : 80}).then(retain);
      if (url.protocol === 'https:') {
        const tls = await connector.startTls(connection!, {hostname: plainHostname(url), alpnProtocols: ['http/1.1']}).then(retain);
        await tls.handshake(); check();
      }
      const request = encoder.encode(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nAccept: text/html,application/xhtml+xml,image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8\r\nAccept-Encoding: identity\r\nConnection: close\r\nUser-Agent: PlatinumCirclesPreview/2.0 (+https://platinumcircles.app)\r\n\r\n`);
      for (let offset = 0; offset < request.length;) {
        check(); const written = await connection!.write(request.subarray(offset));
        if (written <= 0) throw new PreviewError('upstream'); offset += written;
      }
      const reader = new Reader(connection!), {status, headers} = await readHead(reader); check();
      if (redirects.has(status)) return {status, headers, bytes: new Uint8Array()};
      if (status !== 200 || (headers['content-encoding'] && headers['content-encoding'].toLowerCase() !== 'identity')) throw new PreviewError('upstream');
      const mime = (headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (kind === 'html' ? !['text/html','application/xhtml+xml'].includes(mime) : !['image/jpeg','image/png','image/gif','image/webp','image/avif'].includes(mime)) throw new PreviewError('upstream');
      const bytes = await readBody(reader, headers, kind); check();
      return {status, headers, bytes};
    } catch (failure) {
      throw failure instanceof PreviewError ? failure : new PreviewError(signal.aborted ? 'timeout' : 'upstream');
    } finally {close(); signal.removeEventListener('abort', close);}
  };
}
