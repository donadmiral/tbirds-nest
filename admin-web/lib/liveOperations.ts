/** Validate the small staff command surface before it reaches Supabase. */
export const liveId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Preserve the existing database's denial/removal contracts across the HTTP read boundary. */
export function liveReadFailure(cause: unknown, fallback: string): { status: number; error: string } {
  const value = object(cause) ? cause : {};
  const status = value.status ?? value.statusCode ?? (object(value.context) ? value.context.status : undefined);
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (status === 404 || status === 410 || /^(LIVE_NOT_AVAILABLE|CLIP_NOT_AVAILABLE|CLIP_NOT_FOUND)$/.test(message)) {
    return { status: 404, error: 'This broadcast or clip is no longer available.' };
  }
  if (status === 401 || /^PGRST30[123]$/.test(code) || message === 'AUTH_REQUIRED') {
    return { status: 401, error: 'Sign in with an authorized staff account.' };
  }
  if (status === 403 || code === '42501' || /^(ADMIN_ACCESS_DENIED|ACCESS_DENIED|FORBIDDEN|UNAUTHORIZED)$/.test(message)) {
    return { status: 403, error: 'Your staff account no longer has access to this review.' };
  }
  return { status: 503, error: fallback };
}

export const invalidatesLiveRead = (cause: unknown): boolean => liveReadFailure(cause, '').status !== 503;

export type StaffLiveCommand = { action: string; sessionId: string; requestId: string; payload: Record<string,unknown> };
export function parseStaffLiveCommand(value: unknown): StaffLiveCommand | null {
  if (!object(value) || Object.keys(value).some(k=>!['action','sessionId','requestId','payload'].includes(k)) || !liveId(value.sessionId) || !liveId(value.requestId) || !object(value.payload)) return null;
  if (!['admin_warn','admin_chat','admin_remove_viewer','admin_resolve_report','stop'].includes(String(value.action))) return null;
  const payload = value.payload;
  if (typeof payload.reason !== 'string' || !payload.reason.trim() || payload.reason.length > 1000) return null;
  const allowed: Record<string,string[]> = {admin_warn:['reason'],admin_chat:['reason','chat_mode','slow_mode_seconds'],admin_remove_viewer:['reason','user_id'],admin_resolve_report:['reason','report_id'],stop:['reason']};
  if (Object.keys(payload).some(key=>!allowed[String(value.action)].includes(key))) return null;
  if (value.action==='admin_chat' && (payload.chat_mode!==undefined && !['open','followers','closed'].includes(String(payload.chat_mode)) || payload.slow_mode_seconds!==undefined && (!Number.isSafeInteger(payload.slow_mode_seconds) || Number(payload.slow_mode_seconds)<0 || Number(payload.slow_mode_seconds)>120))) return null;
  if (value.action==='admin_remove_viewer' && !liveId(payload.user_id) || value.action==='admin_resolve_report' && !liveId(payload.report_id)) return null;
  return {action:String(value.action),sessionId:value.sessionId,requestId:value.requestId,payload:{...payload,reason:payload.reason.trim()}};
}
export function parseLiveCursor(value: string | null): Record<string,unknown> | null | false {
  if (!value) return null;
  if (value.length>300) return false;
  try { const parsed: unknown=JSON.parse(value);return object(parsed)&&liveId(parsed.id)&&typeof parsed.created_at==='string'&&Number.isFinite(Date.parse(parsed.created_at))&&Object.keys(parsed).every(k=>['id','created_at'].includes(k))?parsed:false; } catch { return false; }
}
export async function readLiveBody(request:Request):Promise<unknown>{
  if(Number(request.headers.get('content-length')||0)>12288)throw new Error('BODY_TOO_LARGE');
  if(!request.body)return null;
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>12288){await reader.cancel();throw new Error('BODY_TOO_LARGE');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
