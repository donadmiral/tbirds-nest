/**
 * sniffMedia — read the first bytes of a local file and type it by
 * signature, never by name or picker label. Born from the 08-24 story
 * that was a QuickTime video named .jpg: names, declared types and
 * extension audits all lied; only bytes tell the truth.
 */
let FS: any = null;
try { FS = require('expo-file-system/legacy'); } catch { try { FS = require('expo-file-system'); } catch {} }

export type SniffResult = {
  ok: boolean;
  kind: 'image' | 'video' | 'unknown';
  ext: string;
  mime: string;
  brand?: string;
};

function b64ToBytes(b64: string): number[] {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (let i = 0; i < b64.length; i++) {
    const c = b64[i];
    if (c === '=') break;
    const v = chars.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return out;
}

function ascii(bytes: number[], start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < bytes.length; i++) {
    const b = bytes[i];
    s += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
  }
  return s;
}

/** Sniff the real type from bytes. Never throws — unknown on any failure. */
export async function sniffMedia(uri: string): Promise<SniffResult> {
  try {
    if (!FS?.readAsStringAsync) return { ok: false, kind: 'unknown', ext: '', mime: '' };
    const b64 = await FS.readAsStringAsync(uri, {
      encoding: 'base64', position: 0, length: 32,
    } as any);
    const b = b64ToBytes(b64);
    if (b.length < 12) return { ok: false, kind: 'unknown', ext: '', mime: '' };

    // JPEG
    if (b[0] === 0xff && b[1] === 0xd8) return { ok: true, kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
    // PNG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ok: true, kind: 'image', ext: 'png', mime: 'image/png' };
    // GIF
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ok: true, kind: 'image', ext: 'gif', mime: 'image/gif' };
    // WEBP (RIFF....WEBP)
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { ok: true, kind: 'image', ext: 'webp', mime: 'image/webp' };
    // WEBM / MKV
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ok: true, kind: 'video', ext: 'webm', mime: 'video/webm', brand: 'webm' };

    // ISO-BMFF family: ....ftypBRND
    if (ascii(b, 4, 4) === 'ftyp') {
      const brand = ascii(b, 8, 4).toLowerCase().trim();
      // HEIC/HEIF image brands
      if (['heic', 'heix', 'heif', 'hevx', 'mif1', 'msf1'].includes(brand)) {
        return { ok: true, kind: 'image', ext: 'heic', mime: 'image/heic', brand };
      }
      // QuickTime
      if (brand.startsWith('qt')) return { ok: true, kind: 'video', ext: 'mov', mime: 'video/quicktime', brand };
      // Everything else in the family is an mp4-style video container
      return { ok: true, kind: 'video', ext: 'mp4', mime: 'video/mp4', brand };
    }

    return { ok: false, kind: 'unknown', ext: '', mime: '' };
  } catch {
    return { ok: false, kind: 'unknown', ext: '', mime: '' };
  }
}

/**
 * Reconcile a declared media type with sniffed bytes.
 * Returns the meta to upload with, and the TRUE media kind so callers
 * can correct a mislabel (photo picked but bytes are a video, etc).
 * HEIC and QuickTime are converted upstream by the compatible picker;
 * if they still reach us (shared files, old assets), we upload them
 * under their TRUE name so nothing unrenderable hides behind a lie.
 */
export async function resolveTrueMeta(
  uri: string,
  declared: 'image' | 'video',
  fallbackExt: string,
  fallbackMime: string,
): Promise<{ ext: string; mime: string; kind: 'image' | 'video'; corrected: boolean }> {
  const s = await sniffMedia(uri);
  if (!s.ok) return { ext: fallbackExt, mime: fallbackMime, kind: declared, corrected: false };
  const corrected = s.kind !== declared || s.ext !== fallbackExt || s.mime !== fallbackMime;
  if (corrected) {
    try { console.log('[sniffMedia] corrected', { declared, fallbackExt, true: s }); } catch {}
  }
  const trueKind: 'image' | 'video' = s.kind === 'unknown' ? declared : s.kind;
  return { ext: s.ext, mime: s.mime, kind: trueKind, corrected };
}
