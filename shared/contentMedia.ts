/** First-party media references remain stable in the database. Capabilities are ephemeral. */
export const CONTENT_BUCKETS = ['post-media', 'story-media', 'media'] as const;
export type ContentKind = 'post' | 'story' | 'sound' | 'story_draft' | 'memory_album' | 'highlight';
export type ContentReference = { kind: ContentKind; id: string };
export const CONTENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function contentObject(value: string, base: string): { bucket: string; path: string; key: string } | null {
  try {
    const url = new URL(value), expected = new URL(base);
    if (url.origin !== expected.origin || url.username || url.password || url.hash) return null;
    const match = url.pathname.match(/^\/(?:storage\/v1\/(?:object\/(?:public|sign|authenticated)|render\/image\/(?:public|sign|authenticated))|functions\/v1\/media-content)\/(post-media|story-media|media)\/(.+)$/);
    if (!match) return null;
    const path = decodeURIComponent(match[2]);
    if (path.length > 1024 || path.includes('%') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) return null;
    return { bucket: match[1], path, key: `${match[1]}/${path}` };
  } catch { return null; }
}

/** Only storage-issued capabilities can replace canonical object references. */
export function isMediaDeliveryCapability(value: string, base: string): boolean {
  if (!contentObject(value, base)) return false;
  const url = new URL(value);
  return url.pathname.startsWith('/functions/v1/media-content/') && /^[0-9a-f]{64}$/.test(url.searchParams.get('token') || '');
}
export function isContentCapability(value: string, base: string): boolean {
  if (isMediaDeliveryCapability(value, base)) return !!contentObject(value, base);
  if (!contentObject(value, base)) return false;
  try {
    const url = new URL(value);
    return /^\/storage\/v1\/(?:object|render\/image)\/sign\//.test(url.pathname) && !!url.searchParams.get('token');
  } catch { return false; }
}

export function contentReferences(rows: unknown[], kind: ContentKind): ContentReference[] {
  const refs = new Map<string, ContentReference>();
  const add = (type: ContentKind, id: unknown) => { if (typeof id === 'string' && CONTENT_UUID.test(id)) refs.set(`${type}:${id}`, { kind: type, id }); };
  const nested = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 15) return;
    if (Array.isArray(value)) { value.forEach(child => nested(child, depth + 1)); return; }
    const object = value as Record<string, unknown>;
    // Embedded post authorization is separate from its containing story/card.
    for (const key of ['postId', 'post_id', 'linked_post_id', 'quoted_post_id']) add('post', object[key]);
    for (const key of ['storyId', 'story_id']) add('story', object[key]);
    Object.values(object).forEach(child => nested(child, depth + 1));
  };
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const object = row as Record<string, unknown>;
    add(kind, kind === 'post' ? object.linked_post_id ?? object.post_id ?? object.id : object.id);
    nested(row);
  }
  return [...refs.values()];
}

/** Match the image grammar used by both ArticleBody renderers, without rewriting prose or links. */
const MARKDOWN_IMAGE = /!\[([^\]\r\n]*)\]\((https?:\/\/[^\s)]+)\)/g;
export function replaceMarkdownMedia(value: string, base: string, capabilities: ReadonlyMap<string, string>): string {
  return value.replace(MARKDOWN_IMAGE, (match, alt: string, url: string) => {
    const object = contentObject(url, base);
    if (!object) return match;
    const signed = capabilities.get(object.key);
    return signed ? `![${alt}](${signed})` : `[${alt || 'Image unavailable'}]`;
  });
}

export function contentMediaUrls(value: unknown, base: string, depth = 0): string[] {
  if (depth > 20 || !value) return [];
  if (typeof value === 'string') {
    const urls = contentObject(value, base) ? [value] : [];
    for (const match of value.matchAll(MARKDOWN_IMAGE)) if (contentObject(match[2], base)) urls.push(match[2]);
    return urls;
  }
  if (typeof value !== 'object') return [];
  return Object.values(value).flatMap(child => contentMediaUrls(child, base, depth + 1));
}

/** Remove transient tokens before saving a reshare or editable media document. */
export function canonicalContentMedia<T>(value: T, base: string): T {
  const canonical = new Map<string, string>();
  for (const url of contentMediaUrls(value, base)) {
    const object = contentObject(url, base);
    if (object) canonical.set(object.key, `${new URL(base).origin}/storage/v1/object/public/${object.bucket}/${object.path.split('/').map(encodeURIComponent).join('/')}`);
  }
  return replaceContentMedia(value, base, canonical);
}

export function replaceContentMedia<T>(value: T, base: string, capabilities: ReadonlyMap<string, string>, depth = 0): T {
  if (depth > 20) return null as T;
  if (typeof value === 'string') {
    const object = contentObject(value, base);
    return (object ? capabilities.get(object.key) ?? null : replaceMarkdownMedia(value, base, capabilities)) as T;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(child => replaceContentMedia(child, base, capabilities, depth + 1)) as T;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    typeof child === 'string' && ['body', 'content', 'caption', 'text', 'title', 'description'].includes(key)
      ? replaceMarkdownMedia(child, base, capabilities) : replaceContentMedia(child, base, capabilities, depth + 1),
  ])) as T;
}

function hasContentMedia(value: unknown, base: string, depth = 0): boolean {
  if (depth > 20 || !value) return false;
  if (typeof value === 'string') return contentMediaUrls(value, base).length > 0;
  if (typeof value !== 'object') return false;
  return Object.values(value).some(child => hasContentMedia(child, base, depth + 1));
}

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Media access timed out. Please try again.')), 20000); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export type ContentMediaClient = {
  auth: {
    getUser(jwt?: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    getSession(): Promise<{ data: { session: { user: { id: string }; access_token: string } | null }; error: unknown }>;
    onAuthStateChange?(callback: (event: string, session: { user: { id: string } } | null) => void): { data: { subscription: { unsubscribe(): void } } };
  };
  functions: { invoke(name: string, options: { body: Record<string, unknown>; headers?: Record<string, string> }): Promise<{ data: unknown; error: unknown }> };
};

export async function hydrateContentMedia<T>(client: ContentMediaClient, base: string, rows: T[], kind: ContentKind): Promise<T[]> {
  if (!rows.length || !hasContentMedia(rows, base)) return rows;
  const refs = contentReferences(rows, kind);
  const batches = [];
  for (let i = 0; i < refs.length; i += 50) batches.push({ references: refs.slice(i, i + 50), delivery: 'no-store' });
  return hydrateMediaBatches(client, base, rows, batches);
}

/** Unpublished uploads are previewed only for the verified storage owner. */
export async function hydrateOwnerUploadMedia<T>(client: ContentMediaClient, base: string, rows: T[]): Promise<T[]> {
  const urls = [...new Set(contentMediaUrls(canonicalContentMedia(rows, base), base))];
  if (!urls.length) return rows;
  const batches = [];
  for (let i = 0; i < urls.length; i += 40) batches.push({ uploads: urls.slice(i, i + 40), delivery: 'no-store' });
  return hydrateMediaBatches(client, base, rows, batches);
}

async function hydrateMediaBatches<T>(client: ContentMediaClient, base: string, rows: T[], batches: Record<string, unknown>[]): Promise<T[]> {
  const { data: initial, error: initialError } = await bounded(client.auth.getSession());
  const viewerId = initial.session?.user.id, token = initial.session?.access_token;
  if (initialError || !viewerId || !token) throw new Error('Sign in again to view this media.');
  let accountChanged = false;
  // Observe switches synchronously, including A -> B -> A while a request is
  // pending. Never call another Auth method from this callback: it owns a lock.
  const watcher = client.auth.onAuthStateChange?.((event, session) => {
    if (event === 'SIGNED_OUT' || session?.user.id !== viewerId) accountChanged = true;
  });
  const assertCurrent = () => { if (accountChanged) throw new Error('Your account changed. Reload this content.'); };
  try {
    // getUser() without a JWT holds the SDK's shared session lock while doing
    // a network request. That blocked unrelated profile/posts/books queries
    // before their fetch deadline even started. Verify the captured JWT with
    // the server explicitly; this overload does not acquire that lock.
    const { data: auth, error: authError } = await bounded(client.auth.getUser(token));
    assertCurrent();
    if (authError || !auth.user) throw new Error('Sign in again to view this media.');
    if (auth.user.id !== viewerId) throw new Error('Your account changed. Reload this content.');
    const capabilities = new Map<string, string>();
    let expiry = Infinity;
    for (const body of batches) {
      assertCurrent();
      // Sign for the same verified identity even if the shared client changes
      // accounts while the request is in flight. The server still authorizes
      // every reference; no canonical URL becomes a capability on the client.
      const { data, error } = await bounded(client.functions.invoke('content-media-sign', { body, headers: { Authorization: `Bearer ${token}` } }));
      assertCurrent();
      if (error || !data || typeof data !== 'object') throw new Error('Media could not be loaded. Please try again.');
      const result = data as { urls?: Array<{ key: string; url: string }>; expiresAt?: number };
      if (!Array.isArray(result.urls) || typeof result.expiresAt !== 'number' || result.expiresAt <= Date.now()) throw new Error('Media access expired. Please try again.');
      expiry = Math.min(expiry, result.expiresAt);
      for (const item of result.urls) {
        const object = typeof item.url === 'string' ? contentObject(item.url, base) : null;
        if (object && object.key === item.key && isContentCapability(item.url, base)) capabilities.set(item.key, item.url);
      }
    }
    const { data: session, error: sessionError } = await bounded(client.auth.getSession());
    assertCurrent();
    if (sessionError || session.session?.user.id !== viewerId) throw new Error('Your account changed. Reload this content.');
    if (expiry <= Date.now()) throw new Error('Media access expired. Please try again.');
    return rows.map(row => {
      const safe = replaceContentMedia(row, base, capabilities);
      return safe && typeof safe === 'object' ? { ...safe, _mediaExpiresAt: Number.isFinite(expiry) ? expiry : null } : safe;
    });
  } finally { watcher?.data.subscription.unsubscribe(); }
}
