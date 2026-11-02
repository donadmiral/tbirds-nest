import {
  DEFAULT_MEMORY_COVER_ARTWORK, DEFAULT_MEMORY_FILM_SETTINGS, LEGACY_MEMORY_FILM_SETTINGS,
  memoryBookCreativeAvailable, parseMemoryCoverArtwork, parseMemoryFilmSettings,
  parseMemoryCreativeSaveResult, type MemoryCoverArtwork, type MemoryFilmSettings, type MemoryCreativeSaveResult,
} from './memoryBookCreative';

type RpcResult = {data: unknown; error: unknown};
type RpcRequest = PromiseLike<RpcResult> & {setHeader: (name: string, value: string) => RpcRequest; abortSignal: (signal: AbortSignal) => RpcRequest};
export type MemoryCreativeClient = {
  rpc: (name: string, args?: Record<string, unknown>) => RpcRequest;
  auth: {getUser: (jwt?: string) => PromiseLike<{data: {user: {id: string} | null}; error: unknown}>;
    getSession: () => PromiseLike<{data: {session: {user: {id: string}; access_token: string} | null}; error: unknown}>;
    onAuthStateChange: (callback: (event: string, session: {user: {id: string}} | null) => void) => {data: {subscription: {unsubscribe: () => void}}}};
};
export type MemoryCreativeDraft = {
  title: string; subtitle: string; color: string; design: string; coverStoryId: string | null;
  artwork: MemoryCoverArtwork; film: MemoryFilmSettings;
};
/** The visual backend confirms UUID/void only; it does not provide a creative revision. */
export type MemoryBookSaveResult = MemoryCreativeSaveResult | {
  id: string; persistence: 'visual'; presentation_revision: null; cover_artwork: null; film_settings: null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = () => new Error('Creative book saving is unavailable. Your draft is kept. Retry after reconnecting.');
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
type Backend = {kind: 'visual'} | {kind: 'creative'; coverArtworkVersions: unknown};

async function readBackend(client: MemoryCreativeClient, signal?: AbortSignal): Promise<Backend> {
  const request = client.rpc('get_memory_book_creative_capabilities');
  const {data, error} = await (signal ? request.abortSignal(signal) : request);
  // A denied, unavailable, or partially installed creative service must never
  // downgrade a write. Match only the missing zero-argument public endpoint.
  if (error && typeof error === 'object' && 'code' in error && error.code === 'PGRST202'
    && 'message' in error && typeof error.message === 'string'
    && /^Could not find the function public\.get_memory_book_creative_capabilities(?: without parameters|\(\)) in the schema cache$/.test(error.message)) {
    return {kind: 'visual'};
  }
  if (!memoryBookCreativeAvailable(data, error)) throw unavailable();
  return {kind: 'creative', coverArtworkVersions: (data as Record<string, unknown>).coverArtworkVersions};
}
function requireCoverVersion(backend: Backend, version: 1 | 2) {
  if (version === 2 && (backend.kind !== 'creative' || !Array.isArray(backend.coverArtworkVersions) || !backend.coverArtworkVersions.includes(2))) {
    throw new Error('Personalized cover saving is unavailable. Your draft is kept. Retry after reconnecting.');
  }
}
/** Resolve defaults before showing a new book's film choices, without changing an edited draft. */
export async function loadMemoryBookDefaultFilmSettings(client: MemoryCreativeClient): Promise<MemoryFilmSettings> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const backend = await Promise.race([readBackend(client, controller.signal), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {controller.abort(); reject(unavailable());}, 10000);
    })]);
    return {...(backend.kind === 'visual' ? LEGACY_MEMORY_FILM_SETTINGS : DEFAULT_MEMORY_FILM_SETTINGS)};
  } finally {if (timeout) clearTimeout(timeout); controller.abort();}
}
export async function requireMemoryCreativeBackend(client: MemoryCreativeClient, coverVersion: 1 | 2 = 1): Promise<void> {
  const backend = await readBackend(client);
  if (backend.kind !== 'creative') throw unavailable();
  requireCoverVersion(backend, coverVersion);
}
async function requireOwner(client: MemoryCreativeClient, ownerId: string, isCurrent: () => boolean) {
  if (!uuid.test(ownerId) || !isCurrent()) throw new Error('The book session changed. Reopen the book before saving.');
  const session = await client.auth.getSession();
  if (session.error || session.data.session?.user.id !== ownerId || !session.data.session.access_token || !isCurrent()) throw new Error('The book session changed. Reopen the book before saving.');
  const {data, error} = await client.auth.getUser(session.data.session.access_token);
  if (error || data.user?.id !== ownerId || !isCurrent()) throw new Error('The book session changed. Reopen the book before saving.');
  return session.data.session.access_token;
}
type Mutation = {name: string; args: Record<string, unknown>; confirm: (data: unknown) => MemoryBookSaveResult};
async function mutate(client: MemoryCreativeClient, ownerId: string, isCurrent: () => boolean, coverVersion: 1 | 2, select: (backend: Backend) => Mutation) {
  let changed = false;
  const controller = new AbortController(), current = () => !changed && !controller.signal.aborted && isCurrent();
  const {data: {subscription}} = client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || session?.user.id !== ownerId) {changed = true; controller.abort();}
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const bound = <T,>(work: PromiseLike<T>) => Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
    const stop = () => reject(new Error(changed ? 'The book session changed. Reopen the book before saving.' : 'The book save could not be confirmed. Your draft is kept; reload before retrying.'));
    controller.signal.addEventListener('abort', stop, {once: true}); if (controller.signal.aborted) stop();
  })]);
  try {
    timeout = setTimeout(() => controller.abort(), 30000);
    const backend = await bound(readBackend(client, controller.signal));
    requireCoverVersion(backend, coverVersion);
    const mutation = select(backend), token = await bound(requireOwner(client, ownerId, current));
    if (!current()) throw new Error('The book session changed. Reopen the book before saving.');
    const {data, error} = await bound(client.rpc(mutation.name, mutation.args).setHeader('Authorization', `Bearer ${token}`).abortSignal(controller.signal));
    if (!current()) throw new Error('The book session changed. Reopen the book before saving.');
    if (error) throw error;
    const result = mutation.confirm(data);
    await bound(requireOwner(client, ownerId, current));
    return result;
  } finally {if (timeout) clearTimeout(timeout); subscription.unsubscribe(); controller.abort();}
}
function payload(draft: MemoryCreativeDraft) {
  const artwork = parseMemoryCoverArtwork(draft.artwork), film = parseMemoryFilmSettings(draft.film);
  if (!artwork || !film || !draft.title.trim() || Array.from(draft.title.trim()).length > 30 || Array.from(draft.subtitle).length > 120) throw new Error('Check the book title and creative settings before saving.');
  return {p_title: draft.title.trim(), p_subtitle: draft.subtitle.trim(), p_cover_color: draft.color,
    p_cover_design: draft.design, p_cover_story_id: draft.coverStoryId, p_cover_artwork: artwork, p_film_settings: film};
}
function visualPayload(args: ReturnType<typeof payload>) {
  if (!same(args.p_cover_artwork, parseMemoryCoverArtwork(DEFAULT_MEMORY_COVER_ARTWORK))
    || !same(args.p_film_settings, parseMemoryFilmSettings(LEGACY_MEMORY_FILM_SETTINGS))) throw unavailable();
  const {p_title, p_subtitle, p_cover_color, p_cover_design, p_cover_story_id} = args;
  return {p_title, p_subtitle, p_cover_color, p_cover_design, p_cover_story_id};
}
const visualAcknowledgement = (id: string): MemoryBookSaveResult => ({id, persistence: 'visual', presentation_revision: null, cover_artwork: null, film_settings: null});
export async function saveMemoryCreativeBook(client: MemoryCreativeClient, options: {ownerId: string; albumId: string; revision: number; audience: string; draft: MemoryCreativeDraft; isCurrent: () => boolean}): Promise<MemoryBookSaveResult> {
  const {ownerId, albumId, revision, audience, draft, isCurrent} = options;
  if (!uuid.test(albumId) || !Number.isSafeInteger(revision) || revision < -1) throw new Error('Reload the book before saving its design.');
  const args = payload(draft);
  return mutate(client, ownerId, isCurrent, args.p_cover_artwork.version, backend => {
    if (backend.kind === 'visual') {
      // A real creative revision must never be discarded by a legacy write.
      if (revision !== -1) throw new Error('Reload the book before saving its design.');
      return {name: 'save_memory_book_presentation', args: {...visualPayload(args), p_album: albumId, p_audience: audience}, confirm: data => {
        if (data !== null) throw new Error('The book save could not be confirmed. Reload the saved book before retrying. Your draft is kept.');
        return visualAcknowledgement(albumId);
      }};
    }
    if (revision < 0) throw new Error('Reload the book before saving its design.');
    return {name: 'save_memory_book_creative_presentation', args: {...args, p_album: albumId, p_expected_revision: revision, p_audience: audience}, confirm: data => {
      const result = parseMemoryCreativeSaveResult(data, albumId);
      if (!result || result.presentation_revision <= revision || !same(result.cover_artwork, args.p_cover_artwork) || !same(result.film_settings, args.p_film_settings)) throw new Error('The book save could not be confirmed. Reload the saved book before retrying. Your draft is kept.');
      return result;
    }};
  });
}
export async function createMemoryCreativeBook(client: MemoryCreativeClient, options: {ownerId: string; requestId: string; storyIds: string[]; draft: MemoryCreativeDraft; isCurrent: () => boolean}): Promise<MemoryBookSaveResult> {
  const {ownerId, requestId, storyIds, draft, isCurrent} = options;
  if (!uuid.test(requestId) || storyIds.length > 80 || new Set(storyIds).size !== storyIds.length || storyIds.some(id => !uuid.test(id))) throw new Error('Choose up to 80 different memories for your book.');
  const args = payload(draft);
  return mutate(client, ownerId, isCurrent, args.p_cover_artwork.version, backend => {
    if (backend.kind === 'visual') return {name: 'create_memory_book_presentation', args: {...visualPayload(args), p_story_ids: [...storyIds]}, confirm: data => {
      if (typeof data !== 'string' || !uuid.test(data)) throw new Error('The book save could not be confirmed. Your draft is kept; reopen your books before creating another.');
      return visualAcknowledgement(data);
    }};
    return {name: 'create_memory_book_creative_presentation', args: {...args, p_request_id: requestId, p_story_ids: [...storyIds]}, confirm: data => {
      const result = parseMemoryCreativeSaveResult(data, requestId);
      if (!result || !same(result.cover_artwork, args.p_cover_artwork) || !same(result.film_settings, args.p_film_settings)) throw new Error('The book save could not be confirmed. Your draft is kept; retry to confirm it.');
      return result;
    }};
  });
}
