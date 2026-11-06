// Server-only integration primitives. Never log arguments, provider bodies,
// authorization codes, upload capabilities, or token-vault plaintext.
export const platforms = ['x', 'facebook', 'instagram', 'youtube', 'tiktok'] as const;
export type Platform = typeof platforms[number];
export const isPlatform = (value: unknown): value is Platform => typeof value === 'string' && platforms.includes(value as Platform);
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const errors = ['AUTH_REQUIRED','ACCESS_DENIED','INVALID_REQUEST','INTEGRATION_NOT_CONFIGURED','INTEGRATION_DISABLED',
  'STATE_EXPIRED','STATE_REPLAYED','ACCOUNT_SELECTION_REQUIRED','ACCOUNT_LIMIT','SCOPES_NOT_GRANTED','TOKEN_EXPIRED','RECONNECT_REQUIRED',
  'PROVIDER_REJECTED','PROVIDER_RATE_LIMITED','PROVIDER_UNAVAILABLE','PROVIDER_RESPONSE_INVALID','OPERATION_AMBIGUOUS',
  'DATABASE_UNAVAILABLE','INVALID_CIPHERTEXT','IDEMPOTENCY_CONFLICT','CLIP_CHANGED','REVIEW_REQUIRED','MEDIA_TOO_LARGE',
  'TRANSCRIPTION_FAILED','PUBLICATION_CONFIRMATION_REQUIRED','UNSUPPORTED_FORMAT'] as const;
export type IntegrationCode = typeof errors[number];
export class IntegrationFailure extends Error {
  constructor(readonly code: IntegrationCode, readonly retryAfterSeconds?: number) { super(code); }
}
export function fail(code: IntegrationCode): never { throw new IntegrationFailure(code); }
export const safeFailure = (error: unknown): IntegrationFailure => error instanceof IntegrationFailure
  && errors.includes(error.code) ? error : new IntegrationFailure('PROVIDER_UNAVAILABLE');

const bytes = (input: Uint8Array): ArrayBuffer => new Uint8Array(input).buffer as ArrayBuffer;
export function base64url(input: Uint8Array): string {
  return btoa(Array.from(input, value => String.fromCharCode(value)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 100000) fail('INVALID_CIPHERTEXT');
  try { return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=')), value => value.charCodeAt(0)); }
  catch { return fail('INVALID_CIPHERTEXT'); }
}
export const randomSecret = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), value => value.toString(16).padStart(2,'0')).join('');
}
export async function challenge(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(verifier)) fail('INVALID_REQUEST');
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
export type Vault = { activeKeyId: string; keys: Record<string,string> };
function vaultKey(vault: Vault, id: string): Uint8Array {
  if (!/^[a-zA-Z0-9_-]{1,24}$/.test(id) || !Object.hasOwn(vault.keys,id)) fail('INTEGRATION_NOT_CONFIGURED');
  const value = decode(vault.keys[id]); if (value.length !== 32) fail('INTEGRATION_NOT_CONFIGURED'); return value;
}
export function validVault(vault: Vault): boolean {
  try { vaultKey(vault,vault.activeKeyId); return Object.keys(vault.keys).length <= 3; } catch { return false; }
}
function associated(context: string): Uint8Array {
  if (!/^(oauth|connection|publish):[a-f0-9-]{36}:[a-f0-9-]{36}:(x|facebook|instagram|youtube|tiktok)$/.test(context)) fail('INVALID_CIPHERTEXT');
  return new TextEncoder().encode(context);
}
export async function seal(vault: Vault, context: string, value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(value)); if (encoded.length > 60000) fail('INVALID_REQUEST');
  const key = await crypto.subtle.importKey('raw',bytes(vaultKey(vault,vault.activeKeyId)), 'AES-GCM',false,['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv:bytes(iv),additionalData:bytes(associated(context)),tagLength:128}, key, encoded);
  return ['v1',vault.activeKeyId,base64url(iv),base64url(new Uint8Array(encrypted))].join('.');
}
export async function unseal(vault: Vault, context: string, envelope: string): Promise<unknown> {
  try {
    if (typeof envelope !== 'string' || envelope.length > 85000) fail('INVALID_CIPHERTEXT');
    const parts = envelope.split('.'); if (parts.length !== 4 || parts[0] !== 'v1') fail('INVALID_CIPHERTEXT');
    const iv = decode(parts[2]); if (iv.length !== 12) fail('INVALID_CIPHERTEXT');
    const key = await crypto.subtle.importKey('raw',bytes(vaultKey(vault,parts[1])), 'AES-GCM',false,['decrypt']);
    const data = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:bytes(associated(context)),tagLength:128},key,bytes(decode(parts[3])));
    if (data.byteLength > 60000) fail('INVALID_CIPHERTEXT'); return JSON.parse(new TextDecoder().decode(data));
  } catch { return fail('INVALID_CIPHERTEXT'); }
}
export async function boundedBytes(response: Response | Request, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length') || 0) > limit) fail('MEDIA_TOO_LARGE');
  const reader = response.body?.getReader(); if (!reader) fail('PROVIDER_RESPONSE_INVALID');
  const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader!.cancel().catch(() => {}); };
  signal.addEventListener('abort',abort,{once:true});
  try {
    for (;;) {
      if (signal.aborted) fail('PROVIDER_UNAVAILABLE');
      const result = await reader!.read(); if (signal.aborted) fail('PROVIDER_UNAVAILABLE'); if (result.done) break;
      size += result.value.length; if (size > limit) fail('MEDIA_TOO_LARGE'); chunks.push(result.value);
    }
  } catch (error) { void reader!.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener('abort',abort); reader!.releaseLock(); }
  const value = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { value.set(chunk,offset); offset += chunk.length; } return value;
}
export async function boundedJson(response: Response | Request, limit: number, signal: AbortSignal): Promise<unknown> {
  const raw = await boundedBytes(response,limit,signal);
  try { return JSON.parse(new TextDecoder().decode(raw)); } catch { return fail('PROVIDER_RESPONSE_INVALID'); }
}
export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 60;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value)-now)/1000;
  return Number.isFinite(seconds) ? Math.max(5,Math.min(86400,Math.ceil(seconds))) : 60;
}
/** Never automatically retry an ambiguous publish, upload-finalization or code exchange. */
export function retryDecision(input: { phase:'read'|'upload'|'publish'|'token_exchange'; attempt:number; status?:number; retryAfter?:number; acknowledged?:boolean }) {
  if (input.phase === 'publish' || input.phase === 'token_exchange') return { retry:false, state:input.acknowledged === false ? 'failed' : 'confirmation_required', after_seconds:null };
  if (input.attempt >= 5 || input.status === 401 || input.status === 403 || input.status && input.status >= 400 && input.status < 500 && input.status !== 429) {
    return { retry:false, state:'failed', after_seconds:null };
  }
  return { retry:true, state:'retry_wait', after_seconds:Math.max(5,Math.min(86400,input.retryAfter ?? 15 * 2 ** Math.max(0,input.attempt-1))) };
}
