// A conservative public-Internet policy. Source: IANA IPv4/IPv6 special-purpose
// registries. Some unusual public anycast ranges are intentionally excluded;
// a missing preview must never become access to an internal service.
import { isIP } from 'node:net';

export class PreviewError extends Error {
  constructor(public readonly code: 'blocked' | 'timeout' | 'upstream' | 'too_large') {
    super(code); this.name = 'PreviewError';
  }
}

export function isPublicAddress(address: string): boolean {
  if (address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6 || address.includes('.')) return false;
  const first = parseInt(address.split(':')[0] || '0',16);
  const second = parseInt(address.split(':')[1] || '0',16);
  // Only global unicast, excluding special protocol assignments, documentation,
  // and 6to4. IPv4-mapped/NAT64/ULA/link-local/loopback never enter this range.
  return first >= 0x2000 && first <= 0x3fff
    && !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8))
    && first !== 0x2002 && first !== 0x3fff;
}

export function plainHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
}

export function previewUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length > 4096 || /[\u0000-\u0020\u007f]/.test(raw)) throw new PreviewError('blocked');
  let url: URL;
  try { url = new URL(raw); } catch { throw new PreviewError('blocked'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port) throw new PreviewError('blocked');
  if (url.hostname.endsWith('.')) url.hostname = url.hostname.slice(0,-1);
  const host = plainHostname(url);
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new PreviewError('blocked');
  } else {
    if (host.length > 253 || !host.includes('.') || /\.(?:localhost|local|internal|lan|home|onion|invalid|test|example)$/.test(host)
      || host.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) throw new PreviewError('blocked');
  }
  url.hash = '';
  return url;
}

export type Address = { address: string; family: number };
export function choosePublicAddress(records: Address[]): Address {
  if (!records.length || records.length > 32 || records.some(row => !isPublicAddress(row.address) || isIP(row.address) !== row.family)) throw new PreviewError('blocked');
  // A validated literal is passed into the socket call. Never resolve the
  // original hostname a second time between inspection and connection.
  return records.find(row => row.family === 4) || records[0];
}
