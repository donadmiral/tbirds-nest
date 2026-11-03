import { boundedResponse, deadline, fail, record, uuid, validateJob, LIMITS } from './protocol.mjs';
const errorCode = code => ({ INTEGRATION_DISABLED: 'INTEGRATION_DISABLED', CLIP_CHANGED: 'CLIP_CHANGED', STATE_EXPIRED: 'CLIP_CHANGED',
  PROVIDER_CAPACITY: 'CAPACITY_LIMIT', DAILY_BUDGET: 'DAILY_LIMIT', CONFIGURATION_CONFLICT: 'AWS_CONFIGURATION_CONFLICT', SETTLEMENT_PENDING: 'CLEANUP_PENDING' })[code];
export function transcriptionBackend(config, { fetcher = fetch } = {}) {
  const endpoint = config.base + '/functions/v1/live-transcription-worker';
  async function call(action, args = {}, parent) {
    const signal = deadline(parent);
    let response;
    try { response = await fetcher(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
      headers: { Authorization: 'Bearer ' + config.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...args }) }); }
    catch { fail(signal.aborted ? 'DEADLINE' : 'BROKER_UNAVAILABLE', true); }
    let value;
    try { value = JSON.parse((await boundedResponse(response, LIMITS.responseBytes, signal)).toString('utf8')); }
    catch (error) { if (error?.code) throw error; fail('BROKER_RESPONSE_INVALID'); }
    if (!response.ok || !record(value?.data)) {
      const code = errorCode(value?.error); if (code) fail(code, ['INTEGRATION_DISABLED', 'CAPACITY_LIMIT', 'DAILY_LIMIT', 'CLEANUP_PENDING'].includes(code));
      fail('BROKER_UNAVAILABLE', response.status >= 500 || response.status === 429);
    }
    if (value.data.error || value.data.ok === false) {
      const code = errorCode(value.data.error) || 'BROKER_RESPONSE_INVALID';
      fail(code, ['INTEGRATION_DISABLED', 'CAPACITY_LIMIT', 'DAILY_LIMIT', 'CLEANUP_PENDING'].includes(code));
    }
    return value.data;
  }
  const proof = job => ({ id: job.id, lease_id: job.lease_id });
  const check = async (job, signal) => {
    const value = await call('check', proof(job), signal);
    if (value.ok !== true || value.id !== job.id || value.clip_id !== job.clip_id || value.job_name !== job.job_name
      || value.duration_ms !== job.duration_ms || value.language !== job.language) fail('CLIP_CHANGED');
    return true;
  };
  return {
    async claim(signal) { const value = await call('claim', {}, signal); if (!Array.isArray(value.items) || value.items.length > 1) fail('BROKER_RESPONSE_INVALID'); return value.items.length ? validateJob(value.items[0]) : null; },
    check,
    async source(job, signal) {
      const value = await call('source', proof(job), signal); let url; try { url = new URL(value.url); } catch { fail('SOURCE_GRANT_INVALID'); }
      const prefix = '/storage/v1/object/sign/live-clips/', parts = url.pathname.slice(prefix.length).split('/');
      if (value.job_name !== job.job_name || value.duration_ms !== job.duration_ms || value.language !== job.language || value.expires_in !== 120
        || url.origin !== config.base || !url.pathname.startsWith(prefix) || url.username || url.password || url.hash || !url.searchParams.get('token')
        || parts.length !== 5 || !parts.slice(0, 4).every(uuid) || parts[2] !== job.clip_id || parts[4] !== job.format + '.mp4') fail('SOURCE_GRANT_INVALID');
      return url.href;
    },
    async submit(job, fingerprint, signal) { return call('submit', { ...proof(job), configuration_hash: fingerprint }, signal); },
    async defer(job, signal) { return call(job.cleanup ? 'cleanup_defer' : 'defer', proof(job), signal); },
    async settle(job, status, signal) { return call('settle', { ...proof(job), provider_status: status }, signal); },
    async finish(job, result, signal) { const value = await call('finish', { ...proof(job), result }, signal); if (value.ok !== true || value.state !== 'draft' || value.requires_review !== true) fail('BROKER_RESPONSE_INVALID'); return true; },
    async fail(job, error, signal) { return call('fail', { ...proof(job), error }, signal); },
  };
}
