/** Timing-only observation for the disposable native UI build. Never imported by the production entry. */
function createAuthDiagnostics({ now = () => globalThis.performance?.now?.() ?? Date.now(), onChange = () => {}, maxEvents = 1024 } = {}) {
  const capacity = Math.max(16, Math.min(4096, Number.isFinite(maxEvents) ? Math.floor(maxEvents) : 1024));
  const firstCapacity = Math.floor(capacity / 2);
  const events = [], locks = new Map(), storageKeys = new Map();
  const holders = new Map(), waiting = new Map(), storage = new Map();
  let nextOperation = 0, droppedEvents = 0, droppedTracking = 0, lastTime = 0;
  let origin;
  const time = () => {
    try {
      const value = now();
      if (Number.isFinite(value)) {
        if (origin === undefined) origin = value;
        lastTime = Math.max(lastTime, value - origin);
      }
    } catch { /* Observation cannot fail an auth operation. */ }
    return Math.round(lastTime * 1000) / 1000;
  };
  const idFor = (map, key) => {
    if (map.has(key)) return map.get(key);
    if (map.size >= 32) return 0;
    const id = map.size + 1; map.set(key, id); return id;
  };
  const track = (map, id, row) => {
    if (map.size < 128) map.set(id, row);
    else droppedTracking++;
  };
  const activeLockIds = () => [...holders.values()].map(row => row.operationId);
  const record = row => {
    if (events.length === capacity) { events.splice(firstCapacity, 1); droppedEvents++; }
    events.push({ ...row, atMs: time() });
    try { onChange(); } catch { /* The optional diagnostic sink cannot alter authentication. */ }
  };
  const observe = (result, complete) => {
    if (!result || typeof result.then !== 'function') { complete('fulfilled'); return result; }
    // Preserve resolved values and the original rejection object. Returning the
    // observed chain also preserves rejected-call visibility when a caller
    // ignores its promise; a detached error observer would hide that rejection.
    return Promise.resolve(result).then(value => { complete('fulfilled'); return value; }, error => {
      complete('rejected', error); throw error;
    });
  };
  const timeoutOutcome = error => {
    try { return error?.isAcquireTimeout === true ? 'acquire-timeout' : 'rejected'; }
    catch { return 'rejected'; }
  };
  function wrapLock(original) {
    return function observedProcessLock(name, acquireTimeout, fn) {
      const operationId = ++nextOperation, lockId = idFor(locks, name), requestedAt = time();
      track(waiting, operationId, { operationId, lockId, requestedAt });
      record({ kind: 'lock', phase: 'requested', operationId, lockId,
        acquireTimeoutMs: Number.isFinite(acquireTimeout) ? acquireTimeout : null,
        activeLockOperationIds: activeLockIds() });
      const wrapped = function (...args) {
        const acquiredAt = time();
        waiting.delete(operationId);
        track(holders, operationId, { operationId, lockId, acquiredAt });
        record({ kind: 'lock', phase: 'acquired', operationId, lockId, waitMs: acquiredAt - requestedAt });
        const complete = outcome => {
          holders.delete(operationId);
          record({ kind: 'lock', phase: 'released', operationId, lockId, outcome, holdMs: time() - acquiredAt });
        };
        try { return observe(Reflect.apply(fn, this, args), complete); }
        catch (error) { complete('rejected'); throw error; }
      };
      const complete = (outcome, error) => {
        waiting.delete(operationId);
        record({ kind: 'lock', phase: 'settled', operationId, lockId,
          outcome: outcome === 'rejected' ? timeoutOutcome(error) : outcome, durationMs: time() - requestedAt });
      };
      try { return observe(Reflect.apply(original, this, [name, acquireTimeout, wrapped]), complete); }
      catch (error) { complete('rejected', error); throw error; }
    };
  }
  function wrapStorage(original) {
    const wrapped = Object.create(original);
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      wrapped[method] = function (...args) {
        const operationId = ++nextOperation, storageId = idFor(storageKeys, args[0]), startedAt = time();
        const activeLockOperationIds = activeLockIds();
        track(storage, operationId, { operationId, storageId, method, startedAt, activeLockOperationIds });
        record({ kind: 'storage', phase: 'started', operationId, storageId, method, activeLockOperationIds });
        const complete = outcome => {
          storage.delete(operationId);
          record({ kind: 'storage', phase: 'settled', operationId, storageId, method, outcome, durationMs: time() - startedAt });
        };
        try { return observe(Reflect.apply(original[method], original, args), complete); }
        catch (error) { complete('rejected'); throw error; }
      };
    }
    return wrapped;
  }
  function snapshot() {
    const atMs = time();
    return {
      schemaVersion: 1, mode: 'synthetic-native-auth-timing', atMs,
      totalOperations: nextOperation, droppedEvents, droppedTracking,
      events: events.map(row => ({ ...row, ...(row.activeLockOperationIds ? { activeLockOperationIds: [...row.activeLockOperationIds] } : {}) })),
      activeLocks: [...holders.values()].map(({ acquiredAt, ...row }) => ({ ...row, holdMs: atMs - acquiredAt })),
      waitingLocks: [...waiting.values()].map(({ requestedAt, ...row }) => ({ ...row, waitMs: atMs - requestedAt })),
      activeStorage: [...storage.values()].map(({ startedAt, ...row }) => ({ ...row, activeLockOperationIds: [...row.activeLockOperationIds], durationMs: atMs - startedAt })),
    };
  }
  return { wrapLock, wrapStorage, snapshot };
}

let nativeRecorder;
function nativeAuthDiagnostics() {
  if (process.env.EXPO_PUBLIC_APP_ENV !== 'qa'
    || process.env.EXPO_PUBLIC_SUPABASE_URL !== 'https://uaulhuelcfkjwojtymmw.supabase.co'
    || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'native-ui-synthetic-no-provider-key') {
    throw new Error('Auth timing diagnostics require the isolated synthetic native UI build.');
  }
  const fixture = require('./fixture-runtime.cjs').fixtureRuntime();
  if (globalThis.fetch !== fixture.fetch) throw new Error('Auth timing diagnostics require the installed synthetic transport.');
  if (nativeRecorder) return nativeRecorder;
  const FileSystem = require('expo-file-system/legacy');
  if (!FileSystem.documentDirectory) throw new Error('Native diagnostic document directory is unavailable.');
  let timer, writing = false, pendingText;
  const writeNext = () => {
    if (writing || pendingText === undefined) return;
    const text = pendingText; pendingText = undefined; writing = true;
    const finished = () => { writing = false; writeNext(); };
    // One write in flight and one latest pending snapshot. Slow disk cannot
    // create an unbounded promise queue or let old data overwrite new data.
    Promise.resolve().then(() => FileSystem.writeAsStringAsync(FileSystem.documentDirectory + 'native-ui-auth-diagnostics.json', text))
      .then(finished, finished);
  };
  const onChange = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      pendingText = JSON.stringify(nativeRecorder.snapshot());
      // Native filesystem only; never recurse through the observed AsyncStorage.
      writeNext();
    }, 250);
  };
  nativeRecorder = createAuthDiagnostics({ onChange });
  return nativeRecorder;
}

module.exports = { createAuthDiagnostics, nativeAuthDiagnostics };
