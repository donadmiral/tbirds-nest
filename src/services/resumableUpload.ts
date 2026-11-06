import { Buffer } from 'buffer';

// Supabase Storage requires 6 MiB chunks, except for the last chunk.
export const STORAGE_CHUNK_BYTES = 6 * 1024 * 1024;

type Reply = { status: number; headers: { get(name: string): string | null } };
export type UploadRequest = (url: string, method: string, headers: Record<string, string>, body?: Uint8Array<ArrayBuffer>) => Promise<Reply | null>;

type Transfer = {
  baseUrl: string;
  bucket: string;
  path: string;
  mime: string;
  size: number;
  read: (offset: number, bytes: number) => Uint8Array<ArrayBuffer>;
  request: UploadRequest;
};

function checkStatus(reply: Reply, expected: number) {
  if (reply.status !== expected) throw new Error('Media upload failed (HTTP ' + reply.status + ').');
}

function offsetFrom(reply: Reply, min: number, max: number) {
  const raw = reply.headers.get('Upload-Offset');
  const value = Number(raw);
  if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error('Storage returned an invalid upload offset.');
  }
  return value;
}

function retryable(status: number) {
  return status === 408 || status === 409 || status === 423 || status === 429 || status >= 500;
}

export async function transferChunks(file: Transfer, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  const endpoint = new URL('/storage/v1/upload/resumable', file.baseUrl);
  if (/^[a-z0-9-]+\.supabase\.co$/.test(endpoint.hostname)) {
    endpoint.hostname = endpoint.hostname.replace('.supabase.co', '.storage.supabase.co');
  }
  const metadata = { bucketName: file.bucket, objectName: file.path, contentType: file.mime, cacheControl: '3600' };
  const created = await file.request(endpoint.href, 'POST', {
    'Upload-Length': String(file.size),
    'Upload-Metadata': Object.entries(metadata).map(([k, v]) => k + ' ' + Buffer.from(v).toString('base64')).join(','),
  });
  if (!created) throw new Error('The upload could not start. Please retry.');
  checkStatus(created, 201);
  const location = created.headers.get('Location');
  if (!location) throw new Error('Storage did not return an upload location.');
  const session = new URL(location, endpoint);
  if (session.origin !== endpoint.origin || session.username || session.password || !session.pathname.startsWith(endpoint.pathname + '/')) {
    throw new Error('Storage returned an unexpected upload location.');
  }

  let offset = 0;
  let attemptedEnd = 0;
  let failures = 0;
  let reconcile = false;
  while (offset < file.size) {
    let reply: Reply | null;
    if (reconcile) {
      reply = await file.request(session.href, 'HEAD', {});
      if (reply && !retryable(reply.status)) {
        if (reply.status !== 204) checkStatus(reply, 200);
        const accepted = offsetFrom(reply, offset, attemptedEnd);
        if (accepted > offset) failures = 0;
        offset = accepted;
        reconcile = false;
        continue;
      }
    } else {
      const length = Math.min(STORAGE_CHUNK_BYTES, file.size - offset);
      const bytes = file.read(offset, length);
      if (bytes.byteLength !== length) throw new Error('The upload file changed while it was being sent.');
      attemptedEnd = offset + length;
      reply = await file.request(session.href, 'PATCH', {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': String(offset),
      }, bytes);
      if (reply && !retryable(reply.status)) {
        checkStatus(reply, 204);
        offset = offsetFrom(reply, attemptedEnd, attemptedEnd);
        failures = 0;
        continue;
      }
    }
    if (++failures > 4) throw new Error('Media upload was interrupted. Keep your draft and retry.');
    await pause(750 * 2 ** (failures - 1));
    reconcile = true;
  }
}
