const { performance } = require('node:perf_hooks');

const states = new Set(['queued', 'processing', 'ready', 'failed', 'deleted', 'review', 'blocked']);
const moderation = new Set(['pending', 'approved', 'rejected']);
const copyright = new Set(['cleared', 'blocked']);
// Fixed worker telemetry codes plus the clip queue's two authority failures.
// Never retain arbitrary error text, even when it resembles an error code.
const errors = new Set(['clip_deadline', 'clip_scratch_unavailable', 'clip_job_invalid',
  'clip_lease_or_authority_lost', 'clip_publication_rejected', 'clip_backend_unavailable',
  'clip_backend_response_limit', 'clip_source_grant_invalid', 'clip_upload_grant_invalid',
  'clip_upload_failed', 'source_not_ready', 'source_download_failed', 'segment_download_failed',
  'recording_timeline_unavailable', 'source_budget', 'clip_output_budget', 'decode_failed',
  'clip_worker_failed', 'authority_or_attempts_exhausted', 'authority_revoked']);
const MAX_POLLS = 128, MAX_TRANSITIONS = 16, MAX_ELAPSED_MS = 300000;
const allowed = (value, values) => typeof value === 'string' && values.has(value) ? value : 'unknown';
function errorCode(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 80) return 'unknown';
  return errors.has(value) || value.startsWith('permanent_') && errors.has(value.slice(10)) ? value : 'unknown';
}

// Records only already-authorized poll results. It makes no requests and never
// retains identities, timestamps, URLs, manifests, tokens or raw responses.
function createClipPollDiagnostic(now = () => performance.now()) {
  let start; try { start = now(); } catch { start = NaN; }
  let polls = 0, transitionCount = 0, last = null, truncated = false;
  const transitions = [];
  return {
    observe(data) {
      try {
        const clip = data?.clip, elapsed = now() - start;
        const sample = { elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(MAX_ELAPSED_MS, Math.round(elapsed)) : null,
          state: allowed(clip?.state, states), moderation: allowed(clip?.moderation_state, moderation),
          copyright: allowed(clip?.copyright_state, copyright), errorCode: errorCode(clip?.error) };
        if (polls < MAX_POLLS) polls++; else truncated = true;
        if (elapsed > MAX_ELAPSED_MS) truncated = true;
        const changed = last && ['state', 'moderation', 'copyright', 'errorCode'].some(key => sample[key] !== last[key]);
        if (changed) { if (transitionCount < MAX_POLLS) transitionCount++; else truncated = true; }
        if (!last || changed) {
          transitions.push(sample);
          // Keep the first observation and the most recent transitions.
          if (transitions.length > MAX_TRANSITIONS) { transitions.splice(1, 1); truncated = true; }
        }
        last = sample;
        return true;
      } catch { return false; } // Observation must never change the poll result.
    },
    snapshot() {
      return { polls, transitionCount, truncated, transitions: transitions.map(item => ({ ...item })), last: last && { ...last } };
    },
  };
}

module.exports = { createClipPollDiagnostic };
