/** Metro aliases expo/fetch only in the guarded disposable full-app build.
 * No native or JavaScript network fallback exists in this module. */
const { Asset } = require('expo-asset');
const { File } = require('expo-file-system');
const { Platform } = require('react-native');
const { fixtureRuntime } = require('./fixture-runtime.cjs');
const assets = {
  'memory-capture-photo.png': require('./assets/memory-capture-photo.png'),
  'memory-capture-sticker.png': require('./assets/memory-capture-sticker.png'),
  'memory-capture-video.mp4': require('./assets/memory-capture-video.mp4'),
};
function aborted() { return Object.assign(new Error('Synthetic media request was cancelled.'), { name: 'AbortError' }); }
async function fetch(url, init = {}) {
  const fixture = fixtureRuntime();
  const allowed = fixture.authorizeMemoryMedia(url);
  if (init.credentials !== 'omit' || init.redirect !== 'error' || init.method && init.method !== 'GET') throw new Error('Unexpected synthetic memory request options.');
  if (init.signal?.aborted) throw aborted();
  if (!Object.hasOwn(assets, allowed.file)) throw new Error('Unknown packaged synthetic media asset.');
  let asset = Asset.fromModule(assets[allowed.file]);
  const resource = Platform.OS === 'android' && /^[a-z0-9_]+$/.test(asset.uri);
  if (!asset.uri.startsWith('file://') && !resource) throw new Error('The synthetic media asset must be packaged in the actual app.');
  if (resource) {
    // Asset.fromModule treats Android drawable names as already downloaded for
    // Image compatibility. A fresh public Asset descriptor asks Expo's native
    // resource reader to materialize these registered bytes in its file cache.
    asset = new Asset({ name: asset.name, type: asset.type, hash: asset.hash, uri: asset.uri });
  }
  await asset.downloadAsync();
  if (!asset.localUri?.startsWith('file://')) throw new Error('The packaged synthetic media is not a local file.');
  const file = new File(asset.localUri);
  if (!file.exists || file.size < 1 || file.size > 8 * 1024 * 1024) throw new Error('The packaged synthetic media size is invalid.');
  const input = file.open();
  let closed = false, locked = false, bytes = 0, pendingReject;
  const close = reason => {
    if (closed) return;
    closed = true;
    input.close();
    init.signal?.removeEventListener('abort', onAbort);
    if (pendingReject) { pendingReject(aborted()); pendingReject = undefined; }
    fixture.recordMemoryMedia({ key: allowed.key, phase: reason, bytes, mode: allowed.mode });
  };
  const onAbort = () => close('cancelled');
  init.signal?.addEventListener('abort', onAbort, { once: true });
  fixture.recordMemoryMedia({ key: allowed.key, phase: 'opened', bytes: 0, mode: allowed.mode });
  if (init.signal?.aborted) { close('cancelled'); throw aborted(); }
  const reader = {
    async read() {
      if (init.signal?.aborted) throw aborted();
      if (closed) return { done: true };
      fixture.authorizeMemoryMedia(url);
      // Hold the second real file chunk until the real UI cancels its export.
      // The production downloader's own deadlines and AbortSignal still apply.
      if (allowed.mode === 'cancel' && bytes) return new Promise((_, reject) => { pendingReject = reject; });
      const value = input.readBytes(allowed.mode === 'cancel' ? 1024 : 64 * 1024);
      if (!value.length) { close('complete'); return { done: true }; }
      bytes += value.length;
      fixture.recordMemoryMedia({ key: allowed.key, phase: 'chunk', bytes, mode: allowed.mode });
      return { done: false, value };
    },
    async cancel() { close('cancelled'); },
    releaseLock() { close('released'); },
  };
  return { ok: true, status: 200, headers: new Headers({ 'content-length': String(file.size) }),
    body: { getReader() { if (locked) throw new Error('Synthetic media reader already locked.'); locked = true; return reader; } } };
}
module.exports = { fetch };
