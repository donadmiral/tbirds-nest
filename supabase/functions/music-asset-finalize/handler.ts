import { inspectOriginalAudio, ORIGINAL_AUDIO_MAX_BYTES } from '../../../shared/originalAudio.ts';
type Upload = { id: string; ownerId: string; path: string; mime: string; bytes: number; sha256: string; status: string; soundId?: string; objectVersion?: string | null };
type Dependencies = {
  getUpload(request: Request, id: string, signal: AbortSignal): Promise<Upload | null>;
  object(upload: Upload, signal: AbortSignal): Promise<{ version: string } | null>;
  download(upload: Upload, signal: AbortSignal): Promise<Response>;
  finish(upload: Upload, duration: number, sha256: string, version: string, signal: AbortSignal): Promise<string | null>;
  digest(bytes: Uint8Array): Promise<string>;
};
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function createMusicFinalizeHandler(deps: Dependencies) {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    // Stream implementations may ignore cancellation or never resolve it.
    // Cleanup must not extend the verification deadline or retain a lock.
    const closeReader = (value?: ReadableStreamDefaultReader<Uint8Array>) => {
      if (!value) return;
      void value.cancel().catch(() => {});
      try { value.releaseLock(); } catch { /* A completed/released reader needs no cleanup. */ }
    };
    const abortReaders = () => { closeReader(bodyReader); closeReader(reader); };
    const requestAborted = () => controller.abort();
    controller.signal.addEventListener('abort', abortReaders, { once: true });
    if (request.signal.aborted) controller.abort();
    else request.signal.addEventListener('abort', requestAborted, { once: true });
    const bounded=<T>(task:Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{
      const expired=()=>reject(new Error('AUDIO_VERIFICATION_DEADLINE'));
      if(controller.signal.aborted){void task.catch(()=>{});expired();return;}
      controller.signal.addEventListener('abort',expired,{once:true});
      task.then(value=>{controller.signal.removeEventListener('abort',expired);resolve(value);},error=>{controller.signal.removeEventListener('abort',expired);reject(error);});
    });
    try {
      if (!request.headers.get('Authorization')?.startsWith('Bearer ')) return reply(401, { error: 'Sign in again to finish the upload.' });
      bodyReader = request.body?.getReader(); if (!bodyReader) return reply(400, { error: 'Upload ID required.' });
      let text = '', bodyBytes = 0;
      try {
        const decoder = new TextDecoder();
        while (true) { const chunk = await bounded(bodyReader.read()); if (chunk.done) break; bodyBytes += chunk.value.byteLength;
          if (bodyBytes > 1024) return reply(413, { error: 'Request too large.' }); text += decoder.decode(chunk.value, { stream: true }); }
      } finally { closeReader(bodyReader); bodyReader = undefined; }
      if (controller.signal.aborted) return reply(408, { error: 'The upload check timed out. Retry the same upload.' });
      let id: string;
      try { id = JSON.parse(text).requestId; } catch { return reply(400, { error: 'Upload ID required.' }); }
      if (typeof id !== 'string' || !uuid.test(id)) return reply(400, { error: 'Upload ID required.' });
      const upload = await bounded(deps.getUpload(request, id, controller.signal));
      if (!upload || upload.id !== id || !uuid.test(upload.ownerId) || !new RegExp(`^${upload.ownerId}/${id}\\.(wav|mp3|m4a)$`, 'i').test(upload.path))
        return reply(403, { error: 'This upload is unavailable for this account.' });
      if (upload.status === 'ready' && upload.soundId) return reply(200, { soundId: upload.soundId });
      if (upload.status !== 'reserved' || upload.bytes < 44 || upload.bytes > ORIGINAL_AUDIO_MAX_BYTES) return reply(400, { error: 'Upload is outside the supported limits.' });
      const object = await bounded(deps.object(upload, controller.signal)); if (!object) return reply(409, { error: 'Finish uploading the audio, then retry verification.' });
      const response = await bounded(deps.download(upload, controller.signal));
      if (!response.ok || !response.body || Number(response.headers.get('Content-Length') || upload.bytes) !== upload.bytes) {
        void response.body?.cancel().catch(() => {}); return reply(409, { error: 'The uploaded file is incomplete. Retry the upload.' });
      }
      reader = response.body.getReader(); const bytes = new Uint8Array(upload.bytes); let offset = 0;
      while (true) { const chunk = await bounded(reader.read()); if (chunk.done) break;
        if (offset + chunk.value.byteLength > bytes.length) return reply(413, { error: 'The uploaded audio exceeds its reservation.' });
        bytes.set(chunk.value, offset); offset += chunk.value.byteLength;
      }
      if (offset !== bytes.length) return reply(409, { error: 'The uploaded file is incomplete. Retry the upload.' });
      const info = inspectOriginalAudio(bytes), digest = await bounded(deps.digest(bytes));
      if (digest !== upload.sha256 || info.mime !== upload.mime) return reply(422, { error: 'The audio bytes do not match the reserved file. Choose the original file again.' });
      if (controller.signal.aborted) return reply(408, { error: 'The upload check timed out. Retry the same upload.' });
      const current = await bounded(deps.getUpload(request, id, controller.signal));
      if (!current || current.ownerId !== upload.ownerId) return reply(403, { error: 'The account changed. Return to the account that uploaded this audio.' });
      const soundId = await bounded(deps.finish(upload, info.durationSec, digest, object.version, controller.signal));
      if (!soundId) return reply(409, { error: 'The audio changed while it was checked. Retry verification.' });
      return reply(200, { soundId, durationSec: info.durationSec });
    } catch (error) {
      if (controller.signal.aborted) return reply(408, { error: 'The upload check timed out. Retry the same upload.' });
      if (error instanceof Error && error.message.startsWith('Choose a complete')) return reply(422, { error: error.message });
      return reply(503, { error: 'Audio verification is temporarily unavailable. Your upload is kept for retry.' });
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abortReaders);
      request.signal.removeEventListener('abort', requestAborted);
      closeReader(bodyReader); closeReader(reader);
    }
  };
}
