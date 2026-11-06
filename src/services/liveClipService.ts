import { Directory, File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { parseLiveClip, type ClipContext, type ClipSpec, type ClipSettings, type LiveClip } from '../../shared/liveClips';
import { isLiveUuid } from '../../shared/liveDirectory';
import { liveFunction, liveObject, liveRequestId, liveRpc, type LiveObject } from './liveService';

/** One adapter owns the native mapping to the server clip contracts. */
export async function loadClipContext(sessionId: string): Promise<ClipContext> {
  const data = await liveRpc('live_clip_context', { p_session_id: sessionId });
  const value = liveObject(data.context) ? data.context : data;
  const row=liveObject(value.settings)?value.settings:{};
  const settings:ClipSettings={viewer_clipping:row.viewer_clipping===true,review_required:row.review_required!==false,watermark_required:row.watermark_required!==false,brand_text:typeof row.brand_text==='string'?row.brand_text.slice(0,80):'',copyright_policy:['standard','owner_only','disabled'].includes(String(row.copyright_policy))?row.copyright_policy as ClipSettings['copyright_policy']:'disabled',approved_user_ids:Array.isArray(row.approved_user_ids)?row.approved_user_ids.filter(isLiveUuid).slice(0,50):[],can_manage:row.can_manage===true};
  return { session_id: sessionId, can_clip: value.can_clip === true, available_start_ms: Math.max(0, Number(value.available_start_ms) || 0), available_end_ms: Math.max(0, Number(value.available_end_ms) || 0), max_duration_ms: Math.min(600000, Number(value.max_duration_ms) || 600000), viewer_clipping: value.viewer_clipping === true, recording_available: value.recording_available === true,can_manage:value.can_manage===true,settings };
}
export async function loadClipLibrary(sessionId: string | null, cursor: unknown = null, sort = 'newest') {
  const data = await liveRpc('live_clip_library', { p_session_id: sessionId, p_cursor: cursor, p_limit: 24, p_sort: sort });
  return { items: Array.isArray(data.items) ? data.items.slice(0,24).map(parseLiveClip).filter((v): v is LiveClip => !!v) : [], cursor: liveObject(data.next_cursor) ? data.next_cursor : null };
}
export async function nativeClipCommand(sessionId: string, clipId: string | null, action: string, payload: LiveObject | ClipSpec, requestId: string) {
  const result = await liveRpc('live_clip_command', { p_session_id: sessionId, p_clip_id: clipId, p_action: action, p_payload: payload, p_request_id: requestId });
  if (result.ok !== true) throw new Error('The clip action was not confirmed. Retry with the same details.');
  return result;
}
export async function clipAsset(clipId: string, format: string) {
  const result = await liveFunction('live-clip-media', { clipId, format });
  let url: URL;
  try { url = new URL(String(result.url)); } catch { throw new Error('The clip download could not be verified.'); }
  const expiry = Date.parse(String(result.expires_at));
  if (url.protocol !== 'https:' || url.username || url.password || !Number.isFinite(expiry) || expiry <= Date.now() + 1000 || expiry > Date.now() + 15 * 60 * 1000) throw new Error('The clip download access could not be verified.');
  return { url: url.href, expiresAt: expiry };
}

const MAX_EXPORT_BYTES = 256 * 1024 * 1024;
/** Stream to a temporary file, count actual bytes, and always remove partial files. */
export async function downloadClip(clipId: string, format: string, signal: AbortSignal): Promise<{ uri: string; dispose(): void }> {
  const asset = await clipAsset(clipId,format);
  if (signal.aborted) throw new Error('Clip export was cancelled.');
  if (Paths.availableDiskSpace < 96 * 1024 * 1024) throw new Error('Free some device storage before downloading this clip.');
  const directory = new Directory(Paths.cache, 'pc-live-clip-' + liveRequestId()); directory.create();
  const file = new File(directory,'platinum-live-clip.mp4'); file.create();
  const controller = new AbortController();
  let handle: ReturnType<File['open']> | null = null, reader: ReadableStreamDefaultReader<Uint8Array> | null = null, bytes = 0, complete = false;
  const dispose = () => { try { directory.delete(); } catch {} };
  const cancel = () => { controller.abort(); void reader?.cancel().catch(()=>{}); };
  signal.addEventListener('abort',cancel,{once:true});
  const timeout = setTimeout(cancel,120000);
  try {
    const response = await expoFetch(asset.url,{ signal: controller.signal, credentials: 'omit', redirect: 'error' });
    const length = Number(response.headers.get('content-length'));
    if (!response.ok || !response.body || length > MAX_EXPORT_BYTES) throw new Error('The video could not download or exceeds the device export limit.');
    reader = response.body.getReader(); handle = file.open();
    while (true) {
      const next = await reader.read();
      if (signal.aborted || controller.signal.aborted) throw new Error('Clip export was cancelled.');
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_EXPORT_BYTES || Paths.availableDiskSpace < next.value.byteLength + 64 * 1024 * 1024) throw new Error('This clip exceeds the available device storage. Try a shorter clip.');
      for (let offset = 0; offset < next.value.byteLength; offset += 65536) handle.writeBytes(next.value.subarray(offset,offset+65536));
    }
    if (!bytes || file.size !== bytes) throw new Error('The video download was incomplete. Retry before sharing.');
    complete = true; return { uri: file.uri, dispose };
  } catch (error) { if (signal.aborted || controller.signal.aborted) throw new Error('The clip download was interrupted. Keep the app open and try again.'); throw error; }
  finally { clearTimeout(timeout); signal.removeEventListener('abort',cancel); cancel(); try { reader?.releaseLock(); } catch {} try { handle?.close(); } catch {} if (!complete) dispose(); }
}
