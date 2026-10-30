/** Server readiness is independent of the commercial catalogue gate. */
import { soundtrackRead } from './soundtrackPicker';
export const ORIGINAL_AUDIO_PREPARING = 'Original audio uploads are not available in this app environment yet. Please try again later.';
type Client = { rpc(name: string): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> };
async function capabilities(client: Client): Promise<{ version?: unknown; uploadsEnabled?: unknown } | null> {
 const { data, error } = await soundtrackRead(client.rpc('get_original_audio_capabilities'));
 if (error) {
  if (error.code === 'PGRST202' || error.code === '42883' || /could not find.*function|does not exist/i.test(error.message || '')) return null;
  if (/BUSINESS_SESSION_REQUIRED/.test(error.message || '')) throw new Error('Original audio needs an approved business sign-in. Use your approved business device.');
  if (/SESSION|AUTH|ACTIVE_ACCOUNT/.test(error.message || '')) throw new Error('Sign in again to use original audio.');
  throw new Error('Audio availability could not be checked. Please retry.');
 }
 return data as { version?: unknown; uploadsEnabled?: unknown } | null;
}
/** Existing verified playback may continue during an upload maintenance window. */
export async function originalAudioSupported(client: Client): Promise<boolean> {
 return (await capabilities(client))?.version === 1;
}
export async function originalAudioReady(client: Client): Promise<boolean> {
 const value=await capabilities(client);
 return value?.version === 1 && value.uploadsEnabled === true;
}
