/** Disposable QA observation. Never retain input events, route params, accounts,
 * callback arguments/results or error contents. No responder decisions change. */
'use strict';
const MAX_EVENTS = 512;
const KEEP_FIRST = 64;
const phases = new Set([
  'installed', 'pressability-attached', 'pressability-unavailable', 'pressability-signal',
  ...['start-live', 'open-book'].flatMap(control => [
    'touch-start', 'touch-end', 'touch-cancel', 'press-in', 'press-out',
    'callback-start', 'callback-return', 'callback-throw',
  ].map(phase => control + '-' + phase)),
  'live-navigation-before', 'live-navigation-after', 'live-navigation-throw',
  'root-navigation-ready', 'root-navigation-commit',
  'new-live-mount', 'new-live-unmount', 'new-live-capability-start',
  'new-live-capability-fulfilled', 'new-live-capability-rejected',
  'new-live-capability-finally', 'new-live-capability-cleanup',
  'open-book-state-commit', 'open-book-scope-reset',
]);
const signals = new Set(['RESPONDER_GRANT', 'RESPONDER_RELEASE', 'RESPONDER_TERMINATED',
  'DELAY', 'ENTER_PRESS_RECT', 'LEAVE_PRESS_RECT', 'LONG_PRESS_DETECTED']);
const routes = new Set(['Main', 'Feed', 'FeedMain', 'LiveStreams', 'NewLive', 'LiveSession',
  'LiveClips', 'Market', 'Jobs', 'Messages', 'Profile', 'ProfileMain', 'MemoryAlbums',
  'MemoryAlbum', 'NativeMemoryCaptureFixture', 'Login', 'AuthCallback']);
const callbackBoundaries = new Set(['start-live', 'open-book']);
const safeRoute = value => routes.has(value) ? value : 'other';

function routeSummary(state) {
  try {
    let current = state, rootRoute = 'unavailable', activeRoute = 'unavailable', depth = 0;
    while (current && Array.isArray(current.routes) && depth < 8) {
      const index = Number.isInteger(current.index) ? current.index : current.routes.length - 1;
      const route = current.routes[index];
      if (!route) break;
      const name = safeRoute(route.name);
      if (depth === 0) rootRoute = name;
      activeRoute = name; depth++; current = route.state;
    }
    return { rootRoute, activeRoute, depth };
  } catch { return { rootRoute: 'unavailable', activeRoute: 'unavailable', depth: 0 }; }
}

function createInputDiagnostics({ write = () => {}, now = Date.now } = {}) {
  const events = [];
  let sequence = 0, dropped = 0, latest = null, writing = false, pending = Promise.resolve();
  function snapshot() {
    return { schemaVersion: 1, mode: 'synthetic-native-input-diagnostics', maxEvents: MAX_EVENTS,
      events: events.map(event => ({ ...event })), dropped,
      meaning: 'Observed callback, navigation and commit boundaries. Dispatch before/after snapshots use the caller state and may precede the root commit. Passive Pressability signals have no target identity and may omit events without a native timestamp.' };
  }
  function persist() {
    try {
      latest = JSON.stringify(snapshot());
      if (writing) return;
      writing = true;
      pending = Promise.resolve().then(async () => {
        while (latest !== null) {
          const value = latest; latest = null;
          try { await write(value); } catch { /* Recording cannot reject app work. */ }
        }
      }).catch(() => {}).finally(() => { writing = false; if (latest !== null) persist(); });
    } catch { /* Serialization or scheduling failure remains observational. */ }
  }
  function record(phase, details = {}) {
    try {
      if (!phases.has(phase)) return false;
      const row = { sequence: sequence = Math.min(Number.MAX_SAFE_INTEGER, sequence + 1), phase };
      try { const at = now(); if (Number.isFinite(at) && at >= 0) row.atUnixMs = at; } catch {}
      for (const key of ['operation', 'request', 'scopeRevision', 'depth']) {
        const value = details[key];
        if (Number.isSafeInteger(value) && value >= 0) row[key] = value;
      }
      if (typeof details.opened === 'boolean') row.opened = details.opened;
      for (const key of ['rootRoute', 'activeRoute']) {
        if (details[key] === 'unavailable' || details[key] === 'other' || routes.has(details[key])) row[key] = details[key];
      }
      if (signals.has(details.signal)) row.signal = details.signal;
      if (typeof details.nativeTimestamp === 'number' && Number.isFinite(details.nativeTimestamp)
        && details.nativeTimestamp >= 0) row.nativeTimestamp = details.nativeTimestamp;
      if (events.length === MAX_EVENTS) {
        events.splice(KEEP_FIRST, 1); dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + 1);
      }
      events.push(row); persist(); return true;
    } catch { return false; }
  }
  return { record, snapshot, flush: async () => { while (writing) await pending; } };
}

let installed;
let operation = 0;
const callbackCache = new WeakMap();
function record(phase, details) {
  try { return installed?.record(phase, typeof details === 'function' ? details() : details) ?? false; }
  catch { return false; }
}
function installInputDiagnostics(options) {
  try {
    if (!installed) installed = createInputDiagnostics(options);
    record('installed'); return installed;
  } catch { return undefined; }
}
function nextOperation() { operation = Math.min(Number.MAX_SAFE_INTEGER, operation + 1); return operation; }

function wrapCallback(boundary, original) {
  if (!callbackBoundaries.has(boundary) || typeof original !== 'function') return original;
  try {
    let cached = callbackCache.get(original);
    if (!cached) { cached = new Map(); callbackCache.set(original, cached); }
    if (cached.has(boundary)) return cached.get(boundary);
    const observed = function (...args) {
      const id = nextOperation();
      record(boundary + '-callback-start', { operation: id });
      try {
        const result = Reflect.apply(original, this, args);
        record(boundary + '-callback-return', { operation: id });
        return result;
      } catch (error) {
        record(boundary + '-callback-throw', { operation: id });
        throw error;
      }
    };
    cached.set(boundary, observed); return observed;
  } catch { return original; }
}

/** The original method is passed separately, evaluated exactly once by the
 * caller. Arguments, receiver, return identity and thrown value are preserved. */
function observeNavigation(original, receiver, args) {
  const id = nextOperation();
  const details = () => {
    let state;
    try { state = receiver.getState(); } catch {}
    return { operation: id, ...routeSummary(state) };
  };
  record('live-navigation-before', details);
  try {
    const result = Reflect.apply(original, receiver, args);
    record('live-navigation-after', details);
    return result;
  } catch (error) {
    record('live-navigation-throw', { operation: id });
    throw error;
  }
}

function navigationObservers(ref) {
  return {
    onReady() { record('root-navigation-ready', () => routeSummary(ref.current?.getRootState())); },
    onStateChange(state) { record('root-navigation-commit', () => routeSummary(state)); },
  };
}

function attachPressabilityEmitter(emitter) {
  let listener;
  try {
    if (typeof emitter?.addListener !== 'function' || typeof emitter?.removeListener !== 'function') {
      record('pressability-unavailable'); return () => {};
    }
    listener = event => {
      try {
        if (signals.has(event?.signal)) record('pressability-signal', {
          signal: event.signal, nativeTimestamp: event.nativeTimestamp,
        });
      } catch { /* Passive emitter listeners must never throw into Pressability. */ }
    };
    emitter.addListener(listener); record('pressability-attached');
  } catch { record('pressability-unavailable'); }
  return () => { try { if (listener) emitter.removeListener(listener); } catch {} };
}

module.exports = { MAX_EVENTS, KEEP_FIRST, createInputDiagnostics, installInputDiagnostics, record,
  wrapCallback, observeNavigation, navigationObservers, attachPressabilityEmitter, routeSummary };
