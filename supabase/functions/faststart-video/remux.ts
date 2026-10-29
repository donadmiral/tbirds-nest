// Pure ISO-BMFF (MP4) faststart remuxer. No ffmpeg, no native deps -
// Uint8Array/DataView only. Moves `moov` to sit right after `ftyp` (before
// `mdat`) so playback can start after the first response chunk instead of
// waiting for the whole file to download to find the metadata at the tail.
// Triggered by a Database Webhook on storage.objects INSERT (see repo notes).

function readBoxHeader(buf: Uint8Array, off: number) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let size = dv.getUint32(off);
  const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
  let headerSize = 8;
  if (size === 1) {
    const hi = dv.getUint32(off + 8);
    const lo = dv.getUint32(off + 12);
    size = hi * 4294967296 + lo;
    headerSize = 16;
  } else if (size === 0) {
    size = buf.length - off;
  }
  return { type, size, headerSize, offset: off };
}

function listTopLevelBoxes(buf: Uint8Array) {
  const boxes: { type: string; size: number; headerSize: number; offset: number }[] = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const b = readBoxHeader(buf, off);
    if (b.size < 8 || off + b.size > buf.length) break;
    boxes.push(b);
    off += b.size;
  }
  return boxes;
}

function patchChunkOffsets(moovBuf: Uint8Array, shift: number) {
  const dv = new DataView(moovBuf.buffer, moovBuf.byteOffset, moovBuf.byteLength);

  function walk(start: number, end: number) {
    let off = start;
    while (off + 8 <= end) {
      const b = readBoxHeader(moovBuf, off);
      if (b.size < 8 || off + b.size > end) throw new Error('malformed nested box');
      if (b.type === 'mvex' || b.type === 'sidx' || b.type === 'moof') {
        throw new Error('fragmented mp4 - not handled');
      }
      if (b.type === 'stco') {
        const countOff = off + b.headerSize + 4;
        const count = dv.getUint32(countOff);
        const base = countOff + 4;
        for (let i = 0; i < count; i++) {
          const p = base + i * 4;
          const v = dv.getUint32(p);
          dv.setUint32(p, (v + shift) >>> 0);
        }
      } else if (b.type === 'co64') {
        const countOff = off + b.headerSize + 4;
        const count = dv.getUint32(countOff);
        const base = countOff + 4;
        for (let i = 0; i < count; i++) {
          const p = base + i * 8;
          const hi = dv.getUint32(p);
          const lo = dv.getUint32(p + 4);
          let v = hi * 4294967296 + lo;
          v += shift;
          dv.setUint32(p, Math.floor(v / 4294967296));
          dv.setUint32(p + 4, v >>> 0);
        }
      } else if (['trak', 'mdia', 'minf', 'stbl', 'udta'].includes(b.type)) {
        walk(off + b.headerSize, off + b.size);
      }
      off += b.size;
    }
  }

  // moovBuf is the whole moov box including its own header; walk its children.
  const moovHeader = readBoxHeader(moovBuf, 0);
  walk(moovHeader.headerSize, moovBuf.length);
}

export function faststartRemux(buf: Uint8Array, maxBytes = 200 * 1024 * 1024): { ok: true; buf: Uint8Array } | { ok: false; reason: string } {
  if (buf.length > maxBytes) return { ok: false, reason: 'too_large' };

  const boxes = listTopLevelBoxes(buf);
  if (boxes.length === 0) return { ok: false, reason: 'unparsable' };

  const ftyp = boxes.find((b) => b.type === 'ftyp');
  const moov = boxes.find((b) => b.type === 'moov');
  const mdat = boxes.find((b) => b.type === 'mdat');
  if (!moov || !mdat) return { ok: false, reason: 'no_moov_or_mdat' };
  if (ftyp && boxes[0].type !== 'ftyp') return { ok: false, reason: 'unexpected_layout' };
  if (boxes.some((b) => b.type === 'moof' || b.type === 'mvex' || b.type === 'sidx')) {
    return { ok: false, reason: 'fragmented' };
  }
  if (moov.offset < mdat.offset) return { ok: false, reason: 'already_faststart' };

  const prefixEnd = ftyp ? ftyp.offset + ftyp.size : 0;
  const moovBytes = buf.slice(moov.offset, moov.offset + moov.size);

  try {
    patchChunkOffsets(moovBytes, moov.size);
  } catch (e) {
    return { ok: false, reason: 'patch_failed: ' + (e as Error).message };
  }

  const prefix = buf.slice(0, prefixEnd);
  const before = buf.slice(prefixEnd, moov.offset);
  const after = buf.slice(moov.offset + moov.size);
  const remaining = new Uint8Array(before.length + after.length);
  remaining.set(before, 0);
  remaining.set(after, before.length);

  const out = new Uint8Array(prefix.length + moovBytes.length + remaining.length);
  out.set(prefix, 0);
  out.set(moovBytes, prefix.length);
  out.set(remaining, prefix.length + moovBytes.length);

  // Structural self-check before anything overwrites the original.
  if (out.length !== buf.length) return { ok: false, reason: 'self_check_size_mismatch' };
  const verify = listTopLevelBoxes(out);
  const vMoov = verify.find((b) => b.type === 'moov');
  const vMdat = verify.find((b) => b.type === 'mdat');
  if (!vMoov || !vMdat || vMoov.offset >= vMdat.offset) {
    return { ok: false, reason: 'self_check_layout_wrong' };
  }

  return { ok: true, buf: out };
}

