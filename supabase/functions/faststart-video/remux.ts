// Faststart changes the MP4 index location, never its codecs or media bytes.
// The inline worker has a separate streaming admission cap. This routine owns
// one output allocation and a small moov copy, avoiding several full-file copies.
export const INLINE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_MOOV_BYTES = 4 * 1024 * 1024;
const MAX_BOXES = 20000, MAX_CHUNK_OFFSETS = 200000, MAX_DEPTH = 16;
type Box = { type: string; size: number; headerSize: number; offset: number };
function boxAt(buf: Uint8Array, off: number, end: number): Box {
  if (off + 8 > end) throw new Error('truncated_box');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let size = dv.getUint32(off), headerSize = 8;
  const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
  if (size === 1) {
    if (off + 16 > end) throw new Error('truncated_extended_box');
    size = dv.getUint32(off + 8) * 4294967296 + dv.getUint32(off + 12); headerSize = 16;
  } else if (size === 0) size = end - off;
  if (!Number.isSafeInteger(size) || size < headerSize || size > end - off) throw new Error('invalid_box_size');
  return { type, size, headerSize, offset: off };
}
function boxesIn(buf: Uint8Array): Box[] {
  const result: Box[] = [];
  for (let off = 0; off < buf.length;) {
    if (result.length >= MAX_BOXES) throw new Error('too_many_boxes');
    const box = boxAt(buf, off, buf.length); result.push(box); off += box.size;
  }
  return result;
}
export function faststartRemux(buf: Uint8Array, maxBytes = INLINE_MAX_BYTES): { ok: true; buf: Uint8Array } | { ok: false; reason: string } {
  if (buf.length > maxBytes) return { ok: false, reason: 'too_large' };
  try {
    const boxes = boxesIn(buf), moovs = boxes.filter(b => b.type === 'moov'), mdats = boxes.filter(b => b.type === 'mdat');
    if (moovs.length !== 1 || !mdats.length) return { ok: false, reason: 'no_unique_moov_or_mdat' };
    if (boxes.filter(b => b.type === 'ftyp').length > 1 || boxes.some((b, i) => b.type === 'ftyp' && i !== 0)) return { ok: false, reason: 'unexpected_layout' };
    if (boxes.some(b => ['moof', 'mvex', 'sidx', 'mfra'].includes(b.type))) return { ok: false, reason: 'fragmented' };
    const moov = moovs[0], prefixEnd = boxes[0]?.type === 'ftyp' ? boxes[0].size : 0;
    if (moov.offset < mdats[0].offset) return { ok: false, reason: 'already_faststart' };
    if (moov.size > MAX_MOOV_BYTES) return { ok: false, reason: 'index_too_large' };
    const index = new Uint8Array(buf.subarray(moov.offset, moov.offset + moov.size));
    const dv = new DataView(index.buffer, index.byteOffset, index.byteLength);
    if (dv.getUint32(0) === 0) dv.setUint32(0, index.length);
    const containsMedia = (position: number) => {
      let low = 0, high = mdats.length - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1, box = mdats[middle];
        if (position < box.offset + box.headerSize) high = middle - 1;
        else if (position >= box.offset + box.size) low = middle + 1;
        else return true;
      }
      return false;
    };
    let visited = 0, offsets = 0;
    function walk(start: number, end: number, depth: number) {
      if (depth > MAX_DEPTH) throw new Error('index_too_deep');
      for (let off = start; off < end;) {
        if (++visited > MAX_BOXES) throw new Error('too_many_boxes');
        const b = boxAt(index, off, end);
        if (['mvex', 'moof', 'sidx', 'saio', 'iloc', 'cmov'].includes(b.type)) throw new Error('unsupported_index');
        if (b.type === 'stco' || b.type === 'co64') {
          const width = b.type === 'stco' ? 4 : 8, countAt = off + b.headerSize + 4;
          if (countAt + 4 > off + b.size) throw new Error('truncated_offsets');
          const count = dv.getUint32(countAt), base = countAt + 4;
          if (count > (off + b.size - base) / width || (offsets += count) > MAX_CHUNK_OFFSETS) throw new Error('invalid_offsets');
          for (let i = 0; i < count; i++) {
            const pos = base + i * width;
            const old = width === 4 ? dv.getUint32(pos) : dv.getUint32(pos) * 4294967296 + dv.getUint32(pos + 4);
            if (!Number.isSafeInteger(old) || !containsMedia(old)) throw new Error('offset_outside_media');
            // Bytes after the old moov keep their positions: moving the index
            // forward both inserts and removes the same byte count.
            const next = old < moov.offset ? old + moov.size : old;
            if (width === 4) {
              if (next > 0xffffffff) throw new Error('offset_overflow');
              dv.setUint32(pos, next);
            } else {
              dv.setUint32(pos, Math.floor(next / 4294967296)); dv.setUint32(pos + 4, next >>> 0);
            }
          }
        } else if (['trak', 'mdia', 'minf', 'stbl', 'udta'].includes(b.type)) walk(off + b.headerSize, off + b.size, depth + 1);
        off += b.size;
      }
    }
    walk(moov.headerSize, index.length, 0);
    if (!offsets) return { ok: false, reason: 'no_chunk_offsets' };
    const out = new Uint8Array(buf.length);
    out.set(buf.subarray(0, prefixEnd)); out.set(index, prefixEnd);
    out.set(buf.subarray(prefixEnd, moov.offset), prefixEnd + index.length);
    out.set(buf.subarray(moov.offset + moov.size), moov.offset + moov.size);
    const verified = boxesIn(out);
    if (verified.find(b => b.type === 'moov')?.offset !== prefixEnd) return { ok: false, reason: 'self_check_failed' };
    return { ok: true, buf: out };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'unparsable' };
  }
}
