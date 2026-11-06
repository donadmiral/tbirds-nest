// The transport uses the caller's Supabase client. Only one chunk is in flight.
type Result = { data: unknown; error: unknown };
type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<Result>;
type Manifest = {
  id: string;
  owner_id: string;
  format: 'jsonl-v1';
  status: 'queued' | 'ready' | 'failed';
  part_count: number;
  byte_count: number;
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const validCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export const archiveId = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

export async function getArchive(rpc: Rpc, owner: string, job?: string): Promise<Manifest> {
  let id = job;
  if (!id) {
    const { data, error } = await rpc('request_account_archive');
    if (error || !archiveId(data)) throw new Error('Could not request your archive. Please retry.');
    id = data;
  }
  const { data, error } = await rpc('read_account_archive', { p_job: id });
  if (error || !record(data) || data.id !== id || data.owner_id !== owner || data.format !== 'jsonl-v1' ||
      !['queued','ready','failed'].includes(String(data.status)) ||
      !validCount(data.part_count) || !validCount(data.byte_count) ||
      (data.status === 'ready' && (!data.part_count || !data.byte_count || data.next_part !== 0))) {
    throw new Error('Your archive could not be confirmed. Request it again.');
  }
  return data as Manifest;
}
export const archiveStatusMessage = (manifest: Manifest) => manifest.status === 'failed'
  ? 'Your archive could not be prepared. Try again in five minutes.'
  : 'Your archive is queued. Check again here in a few minutes.';

export async function* archiveBytes(rpc: Rpc, manifest: Manifest, assertOwner: () => void) {
  if (manifest.status !== 'ready') throw new Error(archiveStatusMessage(manifest));
  let written = 0;
  const encoder = new TextEncoder();
  for (let part = 0; part < manifest.part_count; part++) {
    assertOwner();
    const { data, error } = await rpc('read_account_archive', { p_job: manifest.id, p_part: part });
    assertOwner();
    if (error || !record(data) || data.id !== manifest.id || data.owner_id !== manifest.owner_id ||
        data.part_number !== part || data.next_part !== (part + 1 < manifest.part_count ? part + 1 : null) ||
        typeof data.content !== 'string' || !data.content || data.content.length > 262144) {
      throw new Error('Archive download interrupted. Retry the download.');
    }
    const bytes = encoder.encode(data.content);
    written += bytes.byteLength;
    if (bytes.byteLength > 262144 || written > manifest.byte_count ||
        (data.next_part === null && written !== manifest.byte_count)) {
      throw new Error('Archive size could not be confirmed. Retry the download.');
    }
    yield bytes;
  }
}
