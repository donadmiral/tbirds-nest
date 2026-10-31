/** Bounded QA observation only. No URL, route payload, account value or error
 * detail is retained, and observer failures cannot change the observed work. */
const MAX_CAPTURE_BOUNDARIES = 32;
const MAX_READER_BOUNDARIES = 64;
const phases = new Set(['received', 'parsed', 'parse-failed', 'action-produced', 'action-empty', 'action-failed', 'mounted', 'readback-start', 'readback-complete']);

function notifyReceipt(receipt, onChange) {
  try {
    const pending = onChange(receipt);
    if (pending && typeof pending.then === 'function') Promise.resolve(pending).catch(() => {});
  } catch { /* Observation is best effort. */ }
}

function createCaptureBoundaryRecorder(receipt, onChange, now = Date.now) {
  const events = receipt.captureBoundaries = [];
  receipt.captureBoundaryDropped = 0;
  const notify = () => notifyReceipt(receipt, onChange);
  return (phase, details = {}) => {
    try {
      if (!phases.has(phase)) return false;
      if (events.length >= MAX_CAPTURE_BOUNDARIES) {
        receipt.captureBoundaryDropped = Math.min(Number.MAX_SAFE_INTEGER, receipt.captureBoundaryDropped + 1);
        notify();
        return false;
      }
      const event = { sequence: events.length + 1, phase };
      try {
        const at = now();
        if (Number.isSafeInteger(at) && at >= 0) event.atUnixMs = at;
      } catch { /* Sequence still identifies the boundary when the clock fails. */ }
      if (['received', 'parsed', 'action-produced', 'action-empty', 'action-failed'].includes(phase)) event.matched = details?.matched === true;
      if (phase === 'parsed' || phase === 'parse-failed') event.expectedPath = details?.expectedPath === true;
      if (phase === 'action-produced') event.reset = details?.reset === true;
      if (phase === 'readback-complete') {
        event.fulfilled = details?.fulfilled === true;
        if (event.fulfilled) event.passed = details?.passed === true;
      }
      events.push(event);
      notify();
      return true;
    } catch { return false; }
  };
}

/** Only the two selected synthetic reader responses use this observer. The
 * installed PostgREST adapter consumes text(); it is never read or cloned here. */
function createReaderResponseObserver(receipt, onChange, now = Date.now) {
  const events = receipt.readerResponseBoundaries = [];
  receipt.readerResponseDropped = 0;
  let responseSequence = 0, eventSequence = 0;
  const record = (id, kind, phase, details = {}) => {
    try {
      const event = { sequence: ++eventSequence, id, kind, phase, ...details };
      try {
        const at = now();
        if (Number.isSafeInteger(at) && at >= 0) event.atUnixMs = at;
      } catch { /* Preserve ordering without a timestamp. */ }
      if (events.length >= MAX_READER_BOUNDARIES) {
        events.splice(16, 1); // Keep initial evidence and the most recent boundaries.
        receipt.readerResponseDropped = Math.min(Number.MAX_SAFE_INTEGER, receipt.readerResponseDropped + 1);
      }
      events.push(event);
      notifyReceipt(receipt, onChange);
    } catch { /* Diagnostics cannot affect a response or its body promise. */ }
  };
  return (response, kind) => {
    if (kind !== 'book' && kind !== 'reactions') return response;
    const id = ++responseSequence;
    let bodyObserved = false;
    try {
      const text = response.text;
      if (typeof text === 'function') {
        Object.defineProperty(response, 'text', { configurable: true, writable: true, value: function (...args) {
          record(id, kind, 'body-start');
          let pending;
          try { pending = text.apply(this, args); }
          catch (error) { record(id, kind, 'body-complete', { fulfilled: false }); throw error; }
          try {
            pending.then(() => record(id, kind, 'body-complete', { fulfilled: true }),
              () => record(id, kind, 'body-complete', { fulfilled: false }));
          } catch { /* The original return value is still returned unchanged. */ }
          return pending;
        } });
        bodyObserved = true;
      }
    } catch { /* A non-extensible response remains usable without body tracing. */ }
    const details = { bodyObserved };
    try { const status = response.status; if (Number.isInteger(status) && status >= 100 && status <= 599) details.status = status; } catch { /* No status observation. */ }
    record(id, kind, 'response-ready', details);
    return response;
  };
}

function observeCaptureBoundary(runtime, phase, details) {
  try {
    const fixture = typeof runtime === 'function' ? runtime() : runtime;
    if (typeof fixture?.recordCaptureBoundary !== 'function') return;
    fixture.recordCaptureBoundary(phase, typeof details === 'function' ? details() : details);
  } catch { /* Preserve the original state, action, result and error. */ }
}

function isCaptureState(state) {
  try {
    return state?.routes?.length === 1 && state.routes[0]?.name === 'NativeMemoryCaptureFixture'
      && state.routes[0].path === 'ui-fixture/memory';
  } catch { return false; }
}

module.exports = { MAX_CAPTURE_BOUNDARIES, MAX_READER_BOUNDARIES, createCaptureBoundaryRecorder,
  createReaderResponseObserver, observeCaptureBoundary, isCaptureState };
