import { exportCancelled, exportStep } from './videoExportAudio';
import {assertStaticExportImage,EXPORT_IMAGE_MAX_BYTES} from '../../shared/staticExportImage';
export {assertStaticExportImage,EXPORT_IMAGE_MAX_BYTES} from '../../shared/staticExportImage';
const MAX_CHUNKS=65_536,IMAGE_TIMEOUT=20_000;
const INVALID='An image could not be checked safely for animation. Replace it with a static JPG, PNG or WebP image and retry.';
const TOO_LARGE='An image is larger than the 32 MB movie export limit. Choose a smaller image and retry.';
const TIMED_OUT='An image took too long to check for movie export. Refresh the media and retry.';

/** Read each image once, with a byte cap and an overall deadline, before inlining it. */
export async function fetchStaticExportImage(url: string, signal: AbortSignal): Promise<Blob> {
  exportCancelled(signal);
  // Percent-encoded data URLs can use three characters per byte. Refuse an
  // oversized encoded input before fetch allocates its decoded representation.
  if (url.startsWith('data:') && url.length > EXPORT_IMAGE_MAX_BYTES * 3 + 1024) throw new Error(TOO_LARGE);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => controller.abort(signal.reason);
  const cancelRead = () => { void reader?.cancel(controller.signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  controller.signal.addEventListener('abort', cancelRead, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(TIMED_OUT)), IMAGE_TIMEOUT);
  try {
    const response = await exportStep(fetch(url, { signal: controller.signal, credentials: 'same-origin' }), controller.signal, TIMED_OUT);
    exportCancelled(controller.signal);
    if (!response.ok) throw new Error('A story image could not be downloaded for export.');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > EXPORT_IMAGE_MAX_BYTES) throw new Error(TOO_LARGE);
    if (!response.body) throw new Error(INVALID);
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const next = await exportStep(reader.read(), controller.signal, TIMED_OUT);
      exportCancelled(controller.signal);
      if (next.done) break;
      length += next.value.byteLength;
      if (length > EXPORT_IMAGE_MAX_BYTES) throw new Error(TOO_LARGE);
      if (chunks.length >= MAX_CHUNKS) throw new Error(INVALID);
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    assertStaticExportImage(bytes);
    return new Blob([bytes], { type: response.headers.get('content-type') || 'application/octet-stream' });
  } catch (error) {
    exportCancelled(controller.signal);
    throw error;
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', cancel);
    controller.abort(); cancelRead(); reader?.releaseLock();
    controller.signal.removeEventListener('abort', cancelRead);
  }
}
