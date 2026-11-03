import { fail } from './protocol.mjs';
const projects = ['uaulhuelcfkjwojtymmw', 'prlkikhckbifseosbukl'];
export const TASK_LIFETIME_MS = 240000;
export function loadConfig(env, now = Date.now()) {
  let base; try { base = new URL(env.SUPABASE_URL); } catch { fail('CONFIGURATION_INVALID'); }
  const accountId = env.AWS_ACCOUNT_ID, region = env.AWS_REGION, bucket = env.LIVE_TRANSCRIPTION_BUCKET;
  const dataRoleArn = env.LIVE_TRANSCRIPTION_DATA_ROLE_ARN, secret = env.LIVE_TRANSCRIPTION_WORKER_SECRET;
  const idleMs = env.LIVE_TRANSCRIPTION_IDLE_MS ? Number(env.LIVE_TRANSCRIPTION_IDLE_MS) : 60000;
  const requestedDeadline = env.LIVE_TRANSCRIPTION_TASK_DEADLINE_MS;
  if (requestedDeadline !== undefined && (!/^[0-9]{13}$/.test(requestedDeadline) || !Number.isSafeInteger(Number(requestedDeadline)) || Number(requestedDeadline) > now + TASK_LIFETIME_MS)) fail('CONFIGURATION_INVALID');
  const taskDeadline = Math.min(now + TASK_LIFETIME_MS, requestedDeadline === undefined ? Infinity : Number(requestedDeadline));
  if (!projects.some(project => base.href === `https://${project}.supabase.co/`) || !/^[0-9]{12}$/.test(accountId || '') || region !== 'us-east-2'
    || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket || '') || bucket.includes('..') || /^[0-9.]+$/.test(bucket)
    || typeof dataRoleArn !== 'string' || !new RegExp(`^arn:aws:iam::${accountId}:role/[A-Za-z0-9+=,.@_/-]{1,512}$`).test(dataRoleArn)
    || !/^[A-Za-z0-9_-]{32,200}$/.test(secret || '') || !Number.isInteger(idleMs) || idleMs < 10000 || idleMs > 300000
    || !/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(env.TRANSCRIPTION_DEPLOYMENT || '')) fail('CONFIGURATION_INVALID');
  return { base: base.origin, accountId, region, bucket, dataRoleArn, secret, idleMs, taskDeadline,
    deployment: env.TRANSCRIPTION_DEPLOYMENT, tempRoot: env.TMPDIR || '/scratch', enabled: env.LIVE_TRANSCRIPTION_EXECUTION_ENABLED === 'true' };
}
/** The production executor uses only its ECS task role, never a credential chain or an arbitrary metadata endpoint. */
export function requireTaskRole(env) {
  if (!/^\/v2\/credentials\/[a-fA-F0-9-]{36}$/.test(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || '')
    || ['AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE',
      'AWS_SHARED_CREDENTIALS_FILE', 'AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_ENDPOINT_URL', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL_TRANSCRIBE'].some(name => !!env[name])) fail('CONFIGURATION_INVALID');
}
