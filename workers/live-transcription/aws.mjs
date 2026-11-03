import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { TranscribeClient, GetTranscriptionJobCommand, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { fromContainerMetadata } from '@aws-sdk/credential-providers';
import { createReadStream } from 'node:fs';
import { deadline, fail, WorkerFailure, LIMITS, record } from './protocol.mjs';
import { requireTaskRole } from './config.mjs';

function mapped(error) {
  if (error instanceof WorkerFailure) return error;
  if (['AccessDenied', 'AccessDeniedException', 'UnauthorizedException', 'InvalidAccessKeyId', 'UnrecognizedClientException'].includes(error?.name)
    || error?.$metadata?.httpStatusCode === 403) return new WorkerFailure('AWS_ACCESS_DENIED');
  if (['ThrottlingException', 'TooManyRequestsException', 'LimitExceededException', 'SlowDown'].includes(error?.name)) return new WorkerFailure('AWS_RATE_LIMITED', true);
  return new WorkerFailure('AWS_UNAVAILABLE', true);
}
function missingJob(error) {
  // This API uses BadRequestException for an absent name. Other validation
  // errors must never be converted into permission to start a paid job.
  return error?.name === 'BadRequestException' && typeof error.message === 'string' && error.message.length < 1000
    && /(?:requested job|transcription job).{0,180}(?:couldn.t be found|not found|does not exist)/i.test(error.message);
}
export function validateRemoteJob(value, plan) {
  const required = plan.request, tags = Array.isArray(value?.Tags) ? Object.fromEntries(value.Tags.map(t => [t.Key, t.Value])) : {};
  if (!record(value) || value.TranscriptionJobName !== required.TranscriptionJobName || value.LanguageCode !== required.LanguageCode
    || value.MediaFormat !== 'flac' || value.MediaSampleRateHertz !== 16000 || value.Media?.MediaFileUri !== required.Media.MediaFileUri
    || value.JobExecutionSettings?.DataAccessRoleArn !== required.JobExecutionSettings.DataAccessRoleArn
    || value.JobExecutionSettings?.AllowDeferredExecution !== false || tags.Service !== 'PlatinumLiveCaptions' || tags.ConfigurationHash !== plan.fingerprint
    || !['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(value.TranscriptionJobStatus)) fail('AWS_CONFIGURATION_CONFLICT');
  // TranscriptFileUri and FailureReason are never fetched, returned or logged.
  return value.TranscriptionJobStatus;
}
export function awsOperations(config, { s3, transcribe }) {
  const common = { Bucket: config.bucket, ExpectedBucketOwner: config.accountId };
  const send = async (client, command, parent) => {
    try { return await client.send(command, { abortSignal: deadline(parent) }); } catch (error) { throw error; }
  };
  const inputInfo = async (plan, signal) => {
    let result;
    try { result = await send(s3, new HeadObjectCommand({ ...common, Key: plan.input }), signal); }
    catch (error) { if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null; throw mapped(error); }
    if (!(result.ContentLength >= 100 && result.ContentLength < LIMITS.audioBytes) || result.Metadata?.['configuration-hash'] !== plan.fingerprint
      || result.Metadata?.['transcription-id'] !== plan.id || !/^[a-f0-9]{64}$/.test(result.Metadata?.['audio-sha256'] || '')) fail('AWS_INPUT_CONFLICT');
    return { bytes: result.ContentLength, sha256: result.Metadata['audio-sha256'] };
  };
  return {
    async get(plan, signal) {
      try { const result = await send(transcribe, new GetTranscriptionJobCommand({ TranscriptionJobName: plan.request.TranscriptionJobName }), signal);
        return validateRemoteJob(result.TranscriptionJob, plan); }
      catch (error) { if (missingJob(error)) return null; throw mapped(error); }
    },
    inputInfo,
    async putInput(plan, audio, signal) {
      const body = createReadStream(audio.path);
      try {
        await send(s3, new PutObjectCommand({ ...common, Key: plan.input, Body: body, ContentLength: audio.bytes,
          ContentType: 'audio/flac', ServerSideEncryption: 'AES256', IfNoneMatch: '*', ChecksumSHA256: Buffer.from(audio.sha256, 'hex').toString('base64'),
          Metadata: { 'transcription-id': plan.id, 'configuration-hash': plan.fingerprint, 'audio-sha256': audio.sha256 } }), signal);
      } catch (error) {
        if (['AccessDenied', 'AccessDeniedException'].includes(error?.name)) throw mapped(error);
        // A conditional conflict or lost PUT response is safe only when the
        // fixed object readback matches the exact prepared audio and plan.
        const existing = await inputInfo(plan, signal);
        if (!existing || existing.bytes !== audio.bytes || existing.sha256 !== audio.sha256) fail('AWS_INPUT_CONFLICT');
      } finally { body.destroy(); }
    },
    async start(plan, signal) {
      try {
        const result = await send(transcribe, new StartTranscriptionJobCommand(plan.request), signal);
        return validateRemoteJob(result.TranscriptionJob, plan);
      } catch (error) {
        if (error instanceof WorkerFailure) throw error;
        if (error?.name === 'BadRequestException') throw new WorkerFailure('AWS_REQUEST_REJECTED');
        if (['AccessDeniedException', 'AccessDenied', 'LimitExceededException'].includes(error?.name)) throw mapped(error);
        // Conflict and transport failure both require GET of this same name.
        // The caller retains its durable reservation and never invents a name.
        throw new WorkerFailure('AWS_START_AMBIGUOUS', true);
      }
    },
    async result(plan, parent) {
      const signal = deadline(parent); let response;
      try { response = await send(s3, new GetObjectCommand({ ...common, Key: plan.output }), signal); }
      catch (error) { throw mapped(error); }
      if (Number(response.ContentLength) > LIMITS.resultBytes || !response.Body) { response.Body?.destroy?.(); fail('MEDIA_TOO_LARGE'); }
      const body = response.Body, chunks = []; let size = 0;
      const cancel = () => body.destroy?.(); signal.addEventListener('abort', cancel, { once: true });
      try {
        for await (const chunk of body) {
          if (signal.aborted) fail('DEADLINE', true); size += chunk.length; if (size > LIMITS.resultBytes) fail('MEDIA_TOO_LARGE'); chunks.push(Buffer.from(chunk));
        }
        if (signal.aborted) fail('DEADLINE', true);
        let value; try { value = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { fail('RESULT_INVALID'); }
        if (!record(value) || value.jobName !== plan.request.TranscriptionJobName || value.status !== 'COMPLETED' || !record(value.results)) fail('RESULT_INVALID');
        return value;
      } finally { signal.removeEventListener('abort', cancel); body.destroy?.(); }
    },
    async cleanup(plan, signal) {
      try {
        const result = await send(s3, new DeleteObjectsCommand({ ...common, Delete: { Objects: [{ Key: plan.input }, { Key: plan.output }], Quiet: true } }), signal);
        if (Array.isArray(result.Errors) && result.Errors.length) fail('CLEANUP_PENDING', true);
      } catch (error) { if (error instanceof WorkerFailure) throw error; fail('CLEANUP_PENDING', true); }
    },
  };
}
export function taskRoleAws(config, env = process.env) {
  requireTaskRole(env);
  const credentials = fromContainerMetadata({ timeout: 1000, maxRetries: 0 });
  const settings = { region: config.region, credentials, maxAttempts: 1 };
  const s3 = new S3Client({ ...settings, endpoint: 'https://s3.us-east-2.amazonaws.com', forcePathStyle: true, followRegionRedirects: false });
  const transcribe = new TranscribeClient({ ...settings, endpoint: 'https://transcribe.us-east-2.amazonaws.com' });
  return { ...awsOperations(config, { s3, transcribe }), destroy() { s3.destroy(); transcribe.destroy(); } };
}
