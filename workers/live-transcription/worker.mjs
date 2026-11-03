import { mkdtemp, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { deadline, jobPlan, safeFailure, fail, LIMITS } from './protocol.mjs';
import { downloadSource, prepareAudio } from './audio.mjs';

/** One bounded drain. Long AWS jobs release only their poll lease; provider
 * reservation and daily admission survive restarts, deferral and deletion. */
export function createTranscriptionWorker({ config, api, aws, download = downloadSource, encode = prepareAudio }) {
  return { async drain(parent) {
    const signal = deadline(parent, LIMITS.cycleMs); let job, plan, folder, reserved = false, startAttempted = false;
    const finishSignal = () => deadline(undefined, 5000);
    const retry = async code => { await api.defer(job, finishSignal()).catch(() => {}); return { state: 'deferred', code }; };
    try {
      job = await api.claim(signal); if (!job) return { state: 'idle' };
      plan = jobPlan(job, config); reserved = !!job.configuration_hash;
      if (job.cleanup) {
        const status = await aws.get(plan, signal);
        if (status === 'QUEUED' || status === 'IN_PROGRESS') return retry('CLEANUP_PENDING');
        // For an absent job the broker enforces a two-minute grace after the
        // original reservation before it can release ambiguous submission.
        if (!status) {
          await api.settle(job, 'NOT_FOUND', signal);
          await aws.cleanup(plan, signal);
        } else {
          await aws.cleanup(plan, signal);
          await api.settle(job, status, signal);
        }
        return { state: 'cleaned' };
      }
      await api.check(job, signal);
      let status = await aws.get(plan, signal);
      if (!status) {
        let audio = reserved ? await aws.inputInfo(plan, signal) : null;
        if (!audio) {
          const url = await api.source(job, signal);
          folder = await mkdtemp(path.join(config.tempRoot, 'caption-')); await chmod(folder, 0o700);
          const source = path.join(folder, 'source.mp4'), output = path.join(folder, 'source.flac');
          await download(url, source, signal); await api.check(job, signal);
          audio = await encode(source, output, job.duration_ms, signal);
          await api.check(job, signal); await aws.putInput(plan, audio, signal);
        }
        await api.submit(job, plan.fingerprint, signal); reserved = true;
        // Revocation can occur during download/encoding/upload or reservation.
        await api.check(job, signal); if (signal.aborted) fail('DEADLINE', true);
        startAttempted = true;
        try { status = await aws.start(plan, signal); }
        catch (error) {
          const safe = safeFailure(error);
          if (safe.code !== 'AWS_START_AMBIGUOUS') throw error;
          status = await aws.get(plan, signal); if (!status) return retry('AWS_START_AMBIGUOUS');
        }
      }
      if (status === 'QUEUED' || status === 'IN_PROGRESS') { await api.check(job, signal); return retry('AWS_UNAVAILABLE'); }
      if (status === 'FAILED') {
        await aws.cleanup(plan, signal); if (reserved) await api.settle(job, 'FAILED', signal);
        await api.fail(job, 'TRANSCRIPTION_FAILED', signal); return { state: 'failed', code: 'TRANSCRIPTION_FAILED' };
      }
      if (status !== 'COMPLETED') fail('RESULT_INVALID');
      await api.check(job, signal);
      const result = await aws.result(plan, signal); await api.check(job, signal);
      await api.finish(job, result, signal);
      // Finish is durable and idempotently terminal. Scratch cleanup has a
      // one-day S3 lifecycle fallback if this acknowledgement is lost.
      let cleaned = true; try { await aws.cleanup(plan, signal); } catch { cleaned = false; }
      return { state: 'draft', cleanup_pending: !cleaned };
    } catch (error) {
      const safe = safeFailure(error);
      if (!job) return { state: safe.code === 'INTEGRATION_DISABLED' ? 'disabled' : 'unavailable', code: safe.code };
      if (job.cleanup) return retry(safe.code);
      if (reserved && !startAttempted && !job.configuration_hash && plan && !safe.retryable) {
        // This process knows it never sent Start. Never use this path for a
        // previous/ambiguous reservation from another drain.
        await api.settle(job, 'NOT_SUBMITTED', finishSignal()).catch(() => {});
      }
      if (safe.code === 'CLIP_CHANGED') {
        if (!reserved && plan) await aws.cleanup(plan, finishSignal()).catch(() => {});
        return { state: 'revoked', code: safe.code };
      }
      if (safe.retryable || ['CAPACITY_LIMIT', 'DAILY_LIMIT', 'INTEGRATION_DISABLED'].includes(safe.code)) return retry(safe.code);
      await api.fail(job, safe.code === 'MEDIA_TOO_LARGE' ? 'MEDIA_TOO_LARGE'
        : ['AUDIO_INVALID', 'ENCODE_FAILED', 'TRANSCRIPTION_FAILED'].includes(safe.code) ? 'TRANSCRIPTION_FAILED' : 'PROVIDER_RESPONSE_INVALID', finishSignal()).catch(() => {});
      if (!reserved && plan) await aws.cleanup(plan, finishSignal()).catch(() => {});
      return { state: 'failed', code: safe.code };
    } finally { if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {}); }
  } };
}
