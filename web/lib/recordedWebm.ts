/** Finalize our streaming MediaRecorder WebM's missing Segment/Info/Duration.
 * EBML VINT: RFC 8794; Matroska Duration 0x4489, TimestampScale 0x2AD7B1.
 * This deliberately accepts only a live, unknown-size Segment without indexes.
 * It is not an editor for uploaded/arbitrary Matroska files. Blob slices keep
 * the encoded video out of the JS heap while rewriting the small header.
 */
export async function finalizeRecordedWebm(blob: Blob, seconds: number, durationLimit = 180): Promise<Blob> {
  if (!blob.type.includes('webm')) return blob;
  if (!Number.isFinite(durationLimit) || durationLimit < 1 || durationLimit > 360 || !Number.isFinite(seconds) || seconds <= 0 || seconds > durationLimit) throw new Error('The recorded video duration is invalid.');
  const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  const read = (offset: number, id = false) => {
    let length = 1, mask = 128; while (length <= 8 && !(bytes[offset] & mask)) { length++; mask >>= 1; }
    if (length > (id ? 4 : 8) || offset + length > bytes.length) throw new Error('The browser produced an incomplete video header.');
    let value = id ? bytes[offset] : bytes[offset] & (mask - 1), unknown = !id && value === mask - 1;
    for (let i = 1; i < length; i++) { value = value * 256 + bytes[offset + i]; unknown = unknown && bytes[offset + i] === 255; }
    return { value, length, unknown };
  };
  const element = (offset: number) => { const id = read(offset, true), size = read(offset + id.length); const start = offset + id.length + size.length; return { id: id.value, size: size.value, unknown: size.unknown, sizeOffset: offset + id.length, sizeLength: size.length, start, end: start + size.value }; };
  let root = element(0); if (root.id !== 0x1a45dfa3 || root.unknown) throw new Error('The browser video header is not WebM.');
  const segment = element(root.end);
  if (segment.id !== 0x18538067 || !segment.unknown) return blob; // A finalized file owns its existing indexes/duration.
  let info: ReturnType<typeof element> | null = null;
  for (let at = segment.start; at < bytes.length;) {
    const item = element(at);
    if (item.id === 0x1f43b675) break;
    if (item.id === 0x114d9b74 || item.id === 0x1c53bb6b) return blob; // Never invalidate seek offsets.
    if (item.unknown || item.end > bytes.length) throw new Error('The browser video metadata is incomplete.');
    if (item.id === 0x1549a966) info = item;
    at = item.end;
  }
  if (!info) throw new Error('The recorded video has no duration metadata section.');
  let scale = 1000000, existing: ReturnType<typeof element> | null = null;
  for (let at = info.start; at < info.end;) {
    const item = element(at); if (item.unknown || item.end > info.end) throw new Error('The video duration header is invalid.');
    if (item.id === 0x2ad7b1) { scale = 0; for (let i = item.start; i < item.end; i++) scale = scale * 256 + bytes[i]; }
    if (item.id === 0x4489) existing = item;
    at = item.end;
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('The recorded video time scale is invalid.');
  const duration = seconds * 1e9 / scale;
  if (existing) {
    if (existing.size !== 4 && existing.size !== 8) throw new Error('The recorded video duration field is invalid.');
    const value = new Uint8Array(existing.size), view = new DataView(value.buffer);
    if (existing.size === 4) view.setFloat32(0, duration); else view.setFloat64(0, duration);
    return new Blob([blob.slice(0, existing.start), value, blob.slice(existing.end)], { type: blob.type });
  }
  const durationElement = new Uint8Array(11); durationElement.set([0x44,0x89,0x88]); new DataView(durationElement.buffer).setFloat64(3, duration);
  const size = info.size + durationElement.length;
  let length = info.sizeLength; while (size >= 2 ** (length * 7) - 1 && length < 8) length++;
  const sizeBytes = new Uint8Array(length); let remaining = size;
  for (let i = length - 1; i >= 0; i--) { sizeBytes[i] = remaining % 256; remaining = Math.floor(remaining / 256); }
  sizeBytes[0] |= 1 << (8 - length);
  return new Blob([blob.slice(0, info.sizeOffset), sizeBytes, blob.slice(info.start, info.end), durationElement, blob.slice(info.end)], { type: blob.type });
}
