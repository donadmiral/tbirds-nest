import type { createClient } from './supabase/client';

// Supabase Storage's TUS endpoint currently requires 6 MiB chunks.
// Retain this closure with the publication attempt, whose object path is stable.
export const ATTACHMENT_CHUNK_BYTES = 6 * 1024 * 1024;
export type UploadReceipt = { name: string; size?: number; metadata?: Record<string, unknown> };
type Bucket = 'post-media' | 'story-media' | 'chat-media' | 'chat-files';
type Options = {
  bucket: Bucket;
  projectUrl: string;
  anonKey: string;
  owner: string;
  path: string;
  file: File;
  token: (refresh: boolean) => Promise<string>;
  confirm: (nonce: string) => Promise<boolean>;
  transport?: typeof fetch;
};
export function matchesUpload(receipt: UploadReceipt | null, path: string, size: number, nonce: string) {
  return receipt?.name === path && receipt.size === size && receipt.metadata?.uploadNonce === nonce;
}
const base64 = (text: string) => btoa(Array.from(new TextEncoder().encode(text), b => String.fromCharCode(b)).join(''));

export function createResumableUpload({ bucket, projectUrl, anonKey, owner, path, file, token, confirm, transport = fetch }: Options) {
  const base = new URL(projectUrl);
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname))) ||
      base.username || base.password || !['post-media','story-media','chat-media','chat-files'].includes(bucket) || !owner || path.split('/').length !== 2 ||
      !path.startsWith(owner + '/') || !/^[\w.-]+$/.test(path.slice(owner.length + 1))) {
    throw new Error('Invalid upload destination.');
  }
  if (/^[a-z0-9]{20}\.supabase\.co$/.test(base.hostname)) base.hostname = base.hostname.replace('.supabase.co','.storage.supabase.co');
  const endpoint = new URL('/storage/v1/upload/resumable', base);
  const nonce = crypto.randomUUID();
  let resource: URL | undefined;
  let finalSent = false;
  let done = false;

  async function send(url: URL, method: string, extra: Record<string,string> = {}, body?: Blob) {
    for (const refresh of [false,true]) {
      const access = await token(refresh);
      const resp = await transport(url, {
        method, headers: { Authorization: 'Bearer ' + access, apikey: anonKey, 'Tus-Resumable': '1.0.0', 'x-upsert':'false', ...extra },
        body, credentials:'omit', redirect:'error', cache:'no-store',
        signal: AbortSignal.timeout(120000),
      });
      if (resp.status !== 401 || refresh) return resp;
    }
    throw new Error('Sign in again to continue this upload.');
  }
  function offset(response: Response) {
    const raw = response.headers.get('Upload-Offset');
    const n = Number(raw);
    if (raw === null || !/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n > file.size) throw new Error('Storage returned an invalid resume position.');
    return n;
  }
  async function create() {
    const metadata = { bucketName:bucket, objectName:path, contentType:file.type || 'application/octet-stream',
      cacheControl:'3600', metadata:JSON.stringify({ uploadNonce:nonce }) };
    const response = await send(endpoint,'POST',{ 'Upload-Length':String(file.size),
      'Upload-Metadata':Object.entries(metadata).map(([k,v]) => k+' '+base64(v)).join(',') });
    const location = response.headers.get('Location');
    if (response.status !== 201 || !location) throw new Error('Could not start the attachment upload. Retry this post.');
    const url = new URL(location, endpoint);
    if (url.origin !== endpoint.origin || url.username || url.password || url.hash ||
        !url.pathname.startsWith(endpoint.pathname + '/') || url.pathname.length <= endpoint.pathname.length + 1) {
      throw new Error('Storage returned an unexpected upload destination.');
    }
    return url;
  }
  // A retry must rediscover the server offset. An expired upload can start over
  // at the identical immutable path. Never trust a duplicate-object error as proof.
  return async function upload() {
    await token(false);
    if (done) return;
    if (finalSent && await confirm(nonce)) { done = true; return; }
    let pos = 0;
    if (resource) {
      const head = await send(resource, 'HEAD');
      if (head.status === 404 || head.status === 410) resource = undefined;
      else {
        if (head.status !== 200 && head.status !== 204) throw new Error('Could not check the attachment upload. Retry this post.');
        if (head.headers.get('Upload-Length') !== String(file.size)) throw new Error('Storage returned an unexpected attachment length.');
        pos = offset(head);
      }
    }
    if (!resource) { resource = await create(); finalSent = false; }
    while (pos < file.size) {
      const end = Math.min(pos + ATTACHMENT_CHUNK_BYTES, file.size);
      finalSent = end === file.size;
      const response = await send(resource, 'PATCH', { 'Upload-Offset':String(pos), 'Content-Type':'application/offset+octet-stream' }, file.slice(pos,end));
      if (response.status !== 204 || offset(response) !== end) throw new Error('Attachment upload interrupted. Retry this post to continue.');
      pos = end;
    }
    // A completed resource is bound to this in-memory file and creation request.
    await token(false);
    done = true;
  };
}


export function memberAttachmentUpload(client: ReturnType<typeof createClient>, bucket: Bucket, owner: string,
  path: string, file: File, current: () => boolean) {
  const check = () => { if (!current()) throw new Error('Return to the account and draft that started this upload.'); };
  return createResumableUpload({
    projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    bucket, owner, path, file,
    token: async refresh => {
      check();
      const { data, error } = await (refresh ? client.auth.refreshSession() : client.auth.getSession());
      check();
      if (error || data.session?.user.id !== owner || !data.session.access_token) throw new Error('Sign in to the account that started this upload.');
      return data.session.access_token;
    },
    confirm: async nonce => {
      check();
      const { data } = await client.storage.from(bucket).info(path);
      check();
      return matchesUpload(data, path, file.size, nonce);
    },
  });
}
