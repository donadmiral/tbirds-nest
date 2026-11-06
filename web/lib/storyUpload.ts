import type { createClient } from './supabase/client';
import { ATTACHMENT_CHUNK_BYTES, matchesUpload, memberAttachmentUpload } from './resumableAttachment';

export function createStoryUpload(client: ReturnType<typeof createClient>, owner: string, file: File,
  current: () => boolean, bounded: <T>(work: PromiseLike<T>, timeout?: number) => Promise<T>) {
  const extension = file.name.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ||
    (file.type.startsWith('video/') ? 'mp4' : 'jpg');
  const path = owner + '/' + crypto.randomUUID() + '.' + extension;
  if (file.size > ATTACHMENT_CHUNK_BYTES) {
    return { path, upload: memberAttachmentUpload(client, 'story-media', owner, path, file, current) };
  }
  const bucket = client.storage.from('story-media');
  const nonce = crypto.randomUUID();
  let attempted = false;
  const check = () => { if (!current()) throw new Error('The account changed. Open this story from its original account.'); };
  const upload = async () => {
    check();
    if (attempted) {
      const { data } = await bounded(bucket.info(path));
      check();
      if (matchesUpload(data, path, file.size, nonce)) return;
    }
    attempted = true;
    const { error } = await bounded(bucket.upload(path, file, {
      contentType:file.type, upsert:false, metadata:{uploadNonce:nonce},
    }), 120000);
    check();
    if (error) throw error;
  };
  return { path, upload };
}
