export const EXPORT_IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const MAX_CHUNKS = 65_536;
const UNSUPPORTED = 'Animated image files and GIFs cannot be exported yet. Replace them with a static JPG, PNG or WebP image; no video was created.';
const INVALID = 'An image could not be checked safely for animation. Replace it with a static JPG, PNG or WebP image and retry.';
const TOO_LARGE = 'An image is larger than the 32 MB movie export limit. Choose a smaller image and retry.';
const textAt = (bytes: Uint8Array, offset: number, text: string) => [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

/** Inspect container chunks, not a filename, MIME label or byte sequence inside pixel data. */
export function assertStaticExportImage(bytes: Uint8Array): void {
  if (!bytes.byteLength) throw new Error(INVALID);
  if (bytes.byteLength > EXPORT_IMAGE_MAX_BYTES) throw new Error(TOO_LARGE);
  // GIF is consistently unsupported, including single-frame files and renamed files.
  if (textAt(bytes, 0, 'GIF87a') || textAt(bytes, 0, 'GIF89a')) throw new Error(UNSUPPORTED);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 137 && textAt(bytes, 1, 'PNG')) {
    if (bytes.length < 8 || ![13, 10, 26, 10].every((byte, index) => bytes[4 + index] === byte)) throw new Error(INVALID);
    let offset = 8, chunks = 0, imageData = false;
    while (offset < bytes.length) {
      if (++chunks > MAX_CHUNKS || bytes.length - offset < 12) throw new Error(INVALID);
      const length = view.getUint32(offset), type = offset + 4;
      if (length > bytes.length - offset - 12) throw new Error(INVALID);
      if (chunks === 1 && (!textAt(bytes, type, 'IHDR') || length !== 13)) throw new Error(INVALID);
      // W3C PNG: acTL declares animation; frame chunks are also refused even
      // when a malformed file omits its animation-control chunk.
      if (['acTL', 'fcTL', 'fdAT'].some(name => textAt(bytes, type, name))) throw new Error(UNSUPPORTED);
      if (textAt(bytes, type, 'IDAT')) imageData = true;
      offset += length + 12;
      if (textAt(bytes, type, 'IEND')) {
        if (length || !imageData || offset !== bytes.length) throw new Error(INVALID);
        return;
      }
    }
    throw new Error(INVALID);
  }
  if (textAt(bytes, 0, 'RIFF') && textAt(bytes, 8, 'WEBP')) {
    if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) throw new Error(INVALID);
    let offset = 12, chunks = 0, imageData = false;
    while (offset < bytes.length) {
      if (++chunks > MAX_CHUNKS || bytes.length - offset < 8) throw new Error(INVALID);
      const length = view.getUint32(offset + 4, true), padded = length + (length & 1);
      if (padded > bytes.length - offset - 8) throw new Error(INVALID);
      if (textAt(bytes, offset, 'ANIM') || textAt(bytes, offset, 'ANMF')) throw new Error(UNSUPPORTED);
      if (textAt(bytes, offset, 'VP8X')) {
        if (length !== 10) throw new Error(INVALID);
        if (bytes[offset + 8] & 0x02) throw new Error(UNSUPPORTED);
      }
      if (textAt(bytes, offset, 'VP8 ') || textAt(bytes, offset, 'VP8L')) imageData = true;
      offset += 8 + padded;
    }
    if (!imageData) throw new Error(INVALID);
  }
}

