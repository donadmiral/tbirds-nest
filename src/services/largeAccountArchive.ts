import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { archiveBytes, archiveStatusMessage, getArchive } from '../../shared/accountArchive';
import { readWithDeadline } from '../../shared/readDeadline';
import { supabase } from './supabase';

export async function shareLargeAccountArchive(owner: string, assertOwner: () => void) {
  assertOwner();
  const rpc = (name: string, args?: Record<string, unknown>) => readWithDeadline(supabase.rpc(name, args));
  const manifest = await getArchive(rpc, owner);
  assertOwner();
  if (manifest.status !== 'ready') return archiveStatusMessage(manifest);
  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device. Download your archive from web settings.');
  assertOwner();
  const file = new File(Paths.cache, `platinum-circles-${manifest.id}-${Date.now()}.jsonl`);
  file.create();
  try {
    const handle = file.open();
    try {
      for await (const bytes of archiveBytes(rpc, manifest, assertOwner)) handle.writeBytes(bytes);
    } finally {
      handle.close();
    }
    assertOwner();
    await Sharing.shareAsync(file.uri, { mimeType: 'application/x-ndjson', dialogTitle: 'Your Platinum Circles data' });
    return 'Your archive is ready.';
  } finally {
    if (file.exists) file.delete();
  }
}
