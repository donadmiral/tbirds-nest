/** Disposable QA observations. Never changes a request, cache decision or decoder. */
const FileSystem = require('expo-file-system/legacy');
const BASE = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const receipt = { version: 1, process: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
  startedAt: Date.now(), connectedBackend: true, events: [] };
let writing = Promise.resolve();
const safe = new Set(['postId', 'mediaId', 'sourceVersion', 'cipherFile', 'plainFile', 'kind', 'sourceClass',
  'bytes', 'status', 'path', 'elapsedMs', 'isConnected', 'isInternetReachable', 'currentTime', 'playing', 'firstFrame']);
const videoSamples = new Map();
function record(type, fields = {}) {
  const event = { type, at: Date.now(), elapsedMs: Date.now() - receipt.startedAt };
  for (const [key, value] of Object.entries(fields)) {
    if (!safe.has(key) || !['string', 'number', 'boolean'].includes(typeof value) && value !== null) continue;
    if (typeof value === 'string' && (value.length > 160 || /https?:|Bearer |[?&]token=/i.test(value))) continue;
    event[key] = value;
  }
  receipt.events.push(event);
  if (receipt.events.length > 800) receipt.events.shift();
  const snapshot = JSON.stringify(receipt);
  writing = writing.catch(() => {}).then(() => FileSystem.writeAsStringAsync(
    FileSystem.documentDirectory + 'connected-physical-receipt.json', snapshot)).catch(() => {});
}
function install() {
  const original = globalThis.fetch;
  globalThis.fetch = function (...args) {
    let path;
    try {
      const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url);
      if (url.origin === BASE) path = url.pathname;
    } catch {}
    const started = Date.now();
    return original.apply(this, args).then(response => {
      if (path) record('http-result', { path, status: response.status, elapsedMs: Date.now() - started });
      return response;
    }, error => {
      if (path) record('http-failed', { path, elapsedMs: Date.now() - started });
      throw error;
    });
  };
  record('process-started');
}
function observeConnectivity() {
  // Subscribe only after App imports its normal modules. Do not initialize a
  // replacement detector or alter the real foreground/recovery health probe.
  const { useNetStore } = require('../../src/stores/netStore');
  const observe = state => record('network-state', { isConnected: state.online, isInternetReachable: state.online });
  observe(useNetStore.getState());
  useNetStore.subscribe((state, previous) => { if (state.online !== previous.online) observe(state); });
}
function recordVideo(fields) {
  if (!fields.firstFrame || !fields.playing || !Number.isFinite(fields.currentTime) || fields.currentTime <= .2) return;
  const id = [fields.postId, fields.mediaId, fields.sourceClass].join(':');
  const values = videoSamples.get(id) || [];
  if (values.length >= 2 || values.length && fields.currentTime <= values[0] + .1) return;
  values.push(fields.currentTime);
  videoSamples.set(id, values);
  record('video-progress', fields);
}
module.exports = { install, observeConnectivity, recordVideo, record };
