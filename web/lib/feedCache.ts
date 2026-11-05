import { createFeedSnapshotStore } from '../../shared/feedSnapshot';
import { createClient } from './supabase/client';
import { getFeedPreviewStore, loadFeedPreviews } from './feedPreviews';

let browserStore: ReturnType<typeof createFeedSnapshotStore> | null = null;
/** No request-specific cache instance is ever retained on the server. */
export function getFeedCache() {
  if (typeof window === 'undefined') return createFeedSnapshotStore({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} });
  if (browserStore) return browserStore;
  browserStore = createFeedSnapshotStore({
    getItem: async key => { try { return window.localStorage.getItem(key); } catch { return null; } },
    setItem: async (key, value) => { try { window.localStorage.setItem(key, value); } catch { /* Storage quota or privacy setting. */ } },
    removeItem: async key => { try { window.localStorage.removeItem(key); } catch { /* Storage disabled. */ } },
  });
  const store = browserStore;
  const write = store.write, read = store.read, clear = store.clear;
  store.write = async (...args) => {
    const revision = args[4] ?? store.revision();
    await write(...args);
    if (store.revision() !== revision) return;
    // Raster work is optional and never holds the network/feed refresh open.
    const previews = getFeedPreviewStore();
    if (previews) void loadFeedPreviews(args[0]).then(() => {
      if (store.revision() !== revision) return;
      return previews.write(args[0], args[2] as Parameters<typeof previews.write>[1], args[3]);
    }).catch(() => {});
  };
  store.read = async (...args) => {
    const revision = store.revision();
    const snapshot = await read(...args); if (!snapshot) return null;
    const previews = await loadFeedPreviews(args[0]);
    if (store.revision() !== revision) return null;
    return { ...snapshot, rows: snapshot.rows.map(row => {
      const preview = previews.find(item => item.postId === row.post_id);
      if (!preview) return row;
      if (row.media?.length) return { ...row, media: row.media.map((item: Record<string, unknown>) =>
        item._startupPlaceholder && item.id === preview.mediaId ? { ...item, url: preview.uri,
          _startupPlaceholder: false, _startupPreview: true, _previewObject: preview.object } : item) };
      return { ...row, media: [{ id: preview.mediaId, url: preview.uri, width: preview.width, height: preview.height,
        media_type: 'image', sort_order: 0, edit: null, _startupPreview: true, _startupMediaType: preview.mediaType, _previewObject: preview.object }] };
    }) };
  };
  store.clear = async (...args) => { await Promise.all([clear(...args), getFeedPreviewStore()?.clear()]); };
  // Remains active when Home is unmounted so signing out on any route purges it.
  createClient().auth.onAuthStateChange((_event, session) => { store.setAccount(session?.user.id ?? null); });
  return store;
}
