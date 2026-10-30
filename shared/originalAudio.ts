/** The same bounds are enforced before upload and by the private upload verifier. */
export const ORIGINAL_AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const ORIGINAL_AUDIO_MAX_SECONDS = 600;
export const ORIGINAL_AUDIO_ACCEPT = '.wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4';
export type OriginalAudioInfo = { mime: 'audio/wav' | 'audio/mpeg' | 'audio/mp4'; extension: 'wav' | 'mp3' | 'm4a'; durationSec: number };

function fail(): never { throw new Error('Choose a complete WAV, MP3 or M4A audio file between 1 second and 10 minutes, under 50 MB.'); }
/** Container inspection does not execute a decoder. All lengths and loop counts are bounded. */
export function inspectOriginalAudio(bytes: Uint8Array): OriginalAudioInfo {
  if (bytes.length < 44 || bytes.length > ORIGINAL_AUDIO_MAX_BYTES) return fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const finish = (durationSec: number, mime: OriginalAudioInfo['mime'], extension: OriginalAudioInfo['extension']) => {
    if (!Number.isFinite(durationSec) || durationSec < 1 || durationSec > ORIGINAL_AUDIO_MAX_SECONDS) return fail();
    return { durationSec, mime, extension };
  };
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') {
    if (view.getUint32(4, true) + 8 !== bytes.length) return fail();
    let rate = 0, block = 0, dataBytes = 0, format = false;
    for (let offset = 12, chunks = 0; offset + 8 <= bytes.length && chunks++ < 10000;) {
      const name = text(offset, 4), size = view.getUint32(offset + 4, true), start = offset + 8;
      if (size > bytes.length - start) return fail();
      if (name === 'fmt ') {
        if (size < 16 || format) return fail();
        const codec = view.getUint16(start, true), channels = view.getUint16(start + 2, true);
        const samples = view.getUint32(start + 4, true), bits = view.getUint16(start + 14, true);
        rate = view.getUint32(start + 8, true); block = view.getUint16(start + 12, true);
        if (![1, 3].includes(codec) || channels < 1 || channels > 8 || samples < 8000 || samples > 192000
          || ![8, 16, 24, 32, 64].includes(bits) || block !== channels * bits / 8 || rate !== samples * block) return fail();
        format = true;
      } else if (name === 'data') dataBytes += size;
      offset = start + size + (size % 2);
    }
    if (!format || !dataBytes || dataBytes % block) return fail();
    return finish(dataBytes / rate, 'audio/wav', 'wav');
  }
  if (text(4, 4) === 'ftyp') {
    type Box = { name: string; start: number; end: number };
    let boxCount = 0;
    const boxes = (start: number, end: number): Box[] => {
      const result: Box[] = [];
      for (let offset = start; offset < end;) {
        if (offset + 8 > end || ++boxCount > 100000) return fail();
        let size = view.getUint32(offset), header = 8;
        if (size === 1) {
          if (offset + 16 > end) return fail();
          const large = view.getBigUint64(offset + 8); if (large > BigInt(ORIGINAL_AUDIO_MAX_BYTES)) return fail();
          size = Number(large); header = 16;
        } else if (size === 0) size = end - offset;
        if (size < header || offset + size > end) return fail();
        result.push({ name: text(offset + 4, 4), start: offset + header, end: offset + size }); offset += size;
      }
      return result;
    };
    const child = (box: Box, name: string) => boxes(box.start, box.end).find(item => item.name === name);
    const top = boxes(0, bytes.length), moov = top.find(box => box.name === 'moov');
    if (!moov || !top.some(box => box.name === 'mdat' && box.end > box.start)) return fail();
    let duration = 0, tracks = 0;
    for (const trak of boxes(moov.start, moov.end).filter(box => box.name === 'trak')) {
      const mdia = child(trak, 'mdia'); if (!mdia) return fail();
      const hdlr = child(mdia, 'hdlr'), mdhd = child(mdia, 'mdhd'), minf = child(mdia, 'minf');
      if (!hdlr || hdlr.end - hdlr.start < 12 || text(hdlr.start + 8, 4) !== 'soun' || !mdhd || !minf) return fail();
      const version = bytes[mdhd.start], timescaleOffset = mdhd.start + (version === 1 ? 20 : 12);
      if (![0, 1].includes(version) || timescaleOffset + 4 > mdhd.end) return fail();
      const timescale = view.getUint32(timescaleOffset); if (!timescale) return fail();
      const stbl = child(minf, 'stbl'), dinf = child(minf, 'dinf');
      const stts = stbl && child(stbl, 'stts'), dref = dinf && child(dinf, 'dref');
      if (!stts || stts.start + 8 > stts.end || !dref || dref.start + 8 > dref.end) return fail();
      // External data references could otherwise describe media outside these bytes.
      const refs = boxes(dref.start + 8, dref.end);
      if (!refs.length || refs.some(ref => ref.name !== 'url ' || ref.end - ref.start !== 4 || (view.getUint32(ref.start) & 1) !== 1)) return fail();
      const entries = view.getUint32(stts.start + 4); if (entries > 100000 || stts.start + 8 + entries * 8 !== stts.end) return fail();
      let ticks = 0;
      for (let i = 0; i < entries; i++) {
        const p = stts.start + 8 + i * 8; ticks += view.getUint32(p) * view.getUint32(p + 4);
        if (!Number.isSafeInteger(ticks) || ticks / timescale > ORIGINAL_AUDIO_MAX_SECONDS) return fail();
      }
      duration = Math.max(duration, ticks / timescale); tracks++;
    }
    if (tracks !== 1) return fail();
    return finish(duration, 'audio/mp4', 'm4a');
  }
  let offset = 0;
  if (text(0, 3) === 'ID3') {
    if ([bytes[6], bytes[7], bytes[8], bytes[9]].some(value => value > 127)) return fail();
    offset = 10 + (bytes[6] << 21 | bytes[7] << 14 | bytes[8] << 7 | bytes[9]);
    if (bytes[5] & 16) offset += 10;
  }
  let duration = 0, frames = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes.length - offset === 128 && text(offset, 3) === 'TAG') { offset = bytes.length; break; }
    const header = view.getUint32(offset), version = (header >>> 19) & 3, layer = (header >>> 17) & 3;
    const rateIndex = (header >>> 10) & 3, bitrateIndex = (header >>> 12) & 15, padding = (header >>> 9) & 1;
    if ((header >>> 21) !== 0x7ff || version === 1 || layer !== 1 || rateIndex === 3 || !bitrateIndex || bitrateIndex === 15) return fail();
    const rate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bitrateIndex] * 1000;
    const size = Math.floor((version === 3 ? 144 : 72) * bitrate / rate) + padding;
    if (size < 4 || offset + size > bytes.length) return fail();
    offset += size; duration += (version === 3 ? 1152 : 576) / rate; frames++;
    if (duration > ORIGINAL_AUDIO_MAX_SECONDS || frames > 100000) return fail();
  }
  if (!frames || offset !== bytes.length) return fail();
  return finish(duration, 'audio/mpeg', 'mp3');
}
