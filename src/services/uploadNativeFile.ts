import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { STORAGE_CHUNK_BYTES, transferChunks } from './resumableUpload';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase';

type NativeUpload = {
  uri: string;
  bucket: string;
  path: string;
  mime: string;
  filename: string;
  upsert: boolean;
  token: () => Promise<string>;
};

export async function uploadNativeFile(input: NativeUpload) {
  const headers = async () => ({
    Authorization: 'Bearer ' + await input.token(),
    apikey: SUPABASE_ANON_KEY,
    'x-upsert': String(input.upsert),
  });
  const file = input.uri.startsWith('file://') ? new File(input.uri) : null;
  const size = file?.size ?? 0;
  if (file && size > STORAGE_CHUNK_BYTES) {
    const handle = file.open();
    try {
      await transferChunks({
        ...input, baseUrl: SUPABASE_URL, size,
        read(offset, length) {
          handle.offset = offset;
          return handle.readBytes(length);
        },
        async request(url, method, extraHeaders, body) {
          const auth = await headers();
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 120000);
          try {
            return await expoFetch(url, {
              method, headers: { ...auth, 'Tus-Resumable': '1.0.0', ...extraHeaders },
              body, redirect: 'error', credentials: 'omit', signal: controller.signal,
            });
          } catch {
            // The server may have accepted the bytes even though the response was lost.
            return null;
          } finally { clearTimeout(timer); }
        },
      });
    } finally { handle.close(); }
    return;
  }

  const auth = await headers();
  const form = new FormData();
  form.append('file', { uri: input.uri, type: input.mime, name: input.filename } as any);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(SUPABASE_URL + '/storage/v1/object/' + input.bucket + '/' + input.path, {
      method: 'POST', headers: auth, body: form, signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error('Media upload failed (' + input.bucket + '): ' + (detail.message || detail.error || response.status));
    }
  } finally { clearTimeout(timer); }
}
