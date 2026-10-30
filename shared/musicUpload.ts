import { inspectOriginalAudio } from './originalAudio';
import { soundtrackRead } from './soundtrackPicker';
type Client = {
 auth: { getSession(): Promise<{ data: { session: { user: { id: string }; access_token: string } | null }; error?: unknown }>; onAuthStateChange(callback: (event: string, session: { user: { id: string }; access_token: string } | null) => void): { data: { subscription: { unsubscribe(): void } } } };
 rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};
type Reservation = { id: string; path: string; status: string; soundId?: string };
export type OriginalAudioUpload = { requestId: string; owner: string; title: string; reuseAllowed: boolean; rightsAttested: boolean; bytes: Uint8Array; sha256: string };
/** Reservation and finalization are idempotent. The caller retains requestId on Retry. */
export async function uploadOriginalAudio(client: Client, input: OriginalAudioUpload, transport: {
 upload(path: string, mime: string, token: string): Promise<void>;
 finalize(requestId: string, token: string): Promise<{ soundId: string }>;
}): Promise<string> {
 const info = inspectOriginalAudio(input.bytes);
 if (!input.rightsAttested) throw new Error('Confirm that you own this audio and can publish it.');
 let changed = false;
 const listener = client.auth.onAuthStateChange((_event, session) => { if (!session || session.user.id !== input.owner) changed = true; });
 const check = async () => {
  const { data } = await soundtrackRead(client.auth.getSession());
  if (changed || data.session?.user.id !== input.owner) throw new Error('The account changed. Your original audio remains with its uploader.');
 };
 try {
  const { data: initial } = await soundtrackRead(client.auth.getSession());
  if (changed || initial.session?.user.id !== input.owner) throw new Error('Return to the account that started this upload.');
  const token = initial.session.access_token;
  await check();
  const { data, error } = await soundtrackRead(client.rpc('reserve_original_audio', { p_request_id: input.requestId, p_expected_user: input.owner,
   p_title: input.title.slice(0,200), p_mime: info.mime, p_bytes: input.bytes.byteLength, p_sha256: input.sha256,
   p_reuse: input.reuseAllowed, p_rights_attested: true }));
  if (error?.message && /ORIGINAL_AUDIO_SERVICE_NOT_READY|Could not find.*function|does not exist/i.test(error.message)) throw new Error('Original audio uploads are not available in this app environment yet. Please try again later.');
  if (error || !data) throw new Error(error?.message?.includes('LIMIT') ? 'Your audio upload limit has been reached. Try again tomorrow.' : 'The audio library could not reserve this upload. Please retry.');
  const reservation = data as Reservation;
  if (reservation.id !== input.requestId || reservation.path !== `${input.owner}/${input.requestId}.${info.extension}`) throw new Error('The audio reservation did not match this upload.');
  await check();
  if (reservation.status === 'ready' && reservation.soundId) return reservation.soundId;
  await transport.upload(reservation.path, info.mime, token); await check();
  const result = await transport.finalize(input.requestId, token); await check();
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(result.soundId)) throw new Error('Audio verification did not finish. Retry this upload.');
  return result.soundId;
 } finally { listener.data.subscription.unsubscribe(); }
}
