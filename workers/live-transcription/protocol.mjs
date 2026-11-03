import { createHash } from 'node:crypto';
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const languageCodes = ['en-US', 'en-GB', 'es-US', 'fr-FR', 'de-DE', 'pt-BR', 'it-IT', 'hi-IN', 'ja-JP', 'ko-KR', 'zh-CN', 'ar-SA'];
export const LIMITS = Object.freeze({ sourceBytes: 268435456, audioBytes: 24000000, resultBytes: 2500000, responseBytes: 65536,
  durationMs: 600000, cycleMs: 85000, requestMs: 8000, encodeMs: 35000, downloadMs: 30000 });
export const codes = new Set(['CONFIGURATION_INVALID', 'JOB_INVALID', 'BROKER_UNAVAILABLE', 'BROKER_RESPONSE_INVALID', 'INTEGRATION_DISABLED',
  'CLIP_CHANGED', 'CAPACITY_LIMIT', 'DAILY_LIMIT', 'DEADLINE', 'SOURCE_GRANT_INVALID', 'SOURCE_DOWNLOAD_FAILED', 'MEDIA_TOO_LARGE',
  'AUDIO_INVALID', 'ENCODE_FAILED', 'SCRATCH_UNAVAILABLE', 'AWS_UNAVAILABLE', 'AWS_ACCESS_DENIED', 'AWS_REQUEST_REJECTED', 'AWS_RATE_LIMITED',
  'AWS_CONFIGURATION_CONFLICT', 'AWS_INPUT_CONFLICT', 'AWS_START_AMBIGUOUS', 'TRANSCRIPTION_FAILED', 'RESULT_INVALID', 'CLEANUP_PENDING']);
export class WorkerFailure extends Error {
  constructor(code, retryable = false) { super(codes.has(code) ? code : 'AWS_UNAVAILABLE'); this.code = this.message; this.retryable = retryable; }
}
export const fail = (code, retryable = false) => { throw new WorkerFailure(code, retryable); };
export const safeFailure = error => error instanceof WorkerFailure ? error : new WorkerFailure('AWS_UNAVAILABLE', true);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function deadline(parent, milliseconds = LIMITS.requestMs) { return parent ? AbortSignal.any([parent, AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds); }
export function validateJob(value) {
  if (!record(value) || !uuid(value.id) || !uuid(value.lease_id) || !uuid(value.clip_id)
    || !['horizontal', 'vertical'].includes(value.format) || !languageCodes.includes(value.language)
    || !Number.isSafeInteger(value.duration_ms) || value.duration_ms < 1000 || value.duration_ms > LIMITS.durationMs
    || value.job_name !== 'pc-live-caption-' + value.id.replaceAll('-', '')
    || value.cleanup !== undefined && typeof value.cleanup !== 'boolean'
    || value.configuration_hash !== undefined && value.configuration_hash !== null && !/^[a-f0-9]{64}$/.test(value.configuration_hash)) fail('JOB_INVALID');
  return value;
}
export function jobPlan(job, config) {
  validateJob(job);
  const input = `transcription/${job.id}/source.flac`, output = `transcription/${job.id}/result.json`;
  const request = { TranscriptionJobName: job.job_name, LanguageCode: job.language, MediaFormat: 'flac', MediaSampleRateHertz: 16000,
    Media: { MediaFileUri: `s3://${config.bucket}/${input}` }, OutputBucketName: config.bucket, OutputKey: output,
    JobExecutionSettings: { AllowDeferredExecution: false, DataAccessRoleArn: config.dataRoleArn } };
  const fingerprint = digest(JSON.stringify({ request, clip: job.clip_id, format: job.format, duration_ms: job.duration_ms }));
  request.Tags = [{ Key: 'Service', Value: 'PlatinumLiveCaptions' }, { Key: 'ConfigurationHash', Value: fingerprint }];
  if (job.configuration_hash && job.configuration_hash !== fingerprint) fail('AWS_CONFIGURATION_CONFLICT');
  return { id: job.id, input, output, request, fingerprint };
}
export async function boundedResponse(response, maximum, signal) {
  if (Number(response.headers.get('content-length') || 0) > maximum) { void response.body?.cancel().catch(() => {}); fail('MEDIA_TOO_LARGE'); }
  const reader = response.body?.getReader(); if (!reader) fail('BROKER_RESPONSE_INVALID');
  const chunks = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) fail('DEADLINE', true);
      const { value, done } = await reader.read(); if (signal.aborted) fail('DEADLINE', true); if (done) break;
      size += value.length; if (size > maximum) fail('MEDIA_TOO_LARGE'); chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
