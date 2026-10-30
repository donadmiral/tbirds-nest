/** Server readiness is independent of the commercial catalogue gate. */
import { soundtrackRead } from './soundtrackPicker';
export const ORIGINAL_AUDIO_PREPARING = 'Original audio uploads are not available in this app environment yet. Please try again later.';
type Client = { rpc(name: string): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> };
export type AudioLibraryCapabilities = { version: 1 | 2; uploadsEnabled: boolean; catalogEnabled: boolean };
/** Only a recognized server contract can make library audio available. */
export async function audioLibraryCapabilities(client: Client): Promise<AudioLibraryCapabilities | null> {
 const { data, error } = await soundtrackRead(client.rpc('get_original_audio_capabilities'));
 if (error) {
  const message = error.message || '';
  if (error.code === 'PGRST202' || /\bget_original_audio_capabilities\b/i.test(message) && /could not find.*function|does not exist/i.test(message)) return null;
  if (/BUSINESS_SESSION_REQUIRED/.test(error.message || '')) throw new Error('Original audio needs an approved business sign-in. Use your approved business device.');
  if (/SESSION|AUTH|ACTIVE_ACCOUNT/.test(error.message || '')) throw new Error('Sign in again to use original audio.');
  throw new Error('Audio availability could not be checked. Please retry.');
 }
 if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
 const value = data as { version?: unknown; uploadsEnabled?: unknown; catalogEnabled?: unknown };
 if (value.version !== 1 && value.version !== 2) return null;
 return { version: value.version, uploadsEnabled: value.uploadsEnabled === true,
  catalogEnabled: value.version === 2 && value.catalogEnabled === true };
}
/** A legacy catalogue row cannot bypass server readiness just by naming a source. */
export function librarySourceAvailable(source: unknown, capabilities: AudioLibraryCapabilities | null): boolean {
 return !!capabilities && (source === 'original' || source === 'library' && capabilities.catalogEnabled);
}
/** Existing verified playback may continue during an upload maintenance window. */
export async function originalAudioSupported(client: Client): Promise<boolean> {
 return !!await audioLibraryCapabilities(client);
}
export async function originalAudioReady(client: Client): Promise<boolean> {
 return (await audioLibraryCapabilities(client))?.uploadsEnabled === true;
}
