import 'server-only';
import { requirePermission } from './adminAuth';
import { serviceClient } from './supabaseAdmin';
import { isMissingAdminRpc } from './adminRpcAvailability';

export const ERASURE_HOLDS: Record<string, string> = {
  financial_records: 'Financial or order records require retention review.',
  managed_account: 'Staff, business or organization responsibilities require review.',
  ownership_review: 'Stored-file ownership has not been established.',
  application_review: 'Application-record cleanup requires investigation.',
  storage_changed: 'The stored-file inventory changed and must be investigated.',
  worker_review: 'The erasure worker exhausted its automatic retries.',
};
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const STATES = new Set(['queued', 'erasing', 'retry', 'identity_pending', 'retention_review', 'completed', 'cancelled']);

export async function runErasureReview(form: FormData) {
  const admin = await requirePermission('account_delete');
  const values: Record<string, string> = {};
  const allowed = new Set(['command_key', 'source', 'request_id', 'version', 'action', 'note', 'confirm']);
  for (const [name, value] of form.entries()) {
    if (name.startsWith('$ACTION_')) continue;
    if (!allowed.has(name) || typeof value !== 'string' || Object.hasOwn(values, name)) {
      return { success: false as const, error: 'The form is invalid. Reload the request.' };
    }
    values[name] = value;
  }
  const note = values.note?.trim() || '';
  if (!UUID.test(values.command_key || '') || !UUID.test(values.request_id || '')
    || !['admin', 'self_service'].includes(values.source) || !/^[0-9a-f]{32}$/.test(values.version || '')
    || !['note', 'resume'].includes(values.action) || Array.from(note).length < 20 || Array.from(note).length > 2000) {
    return { success: false as const, error: 'Reload the request and enter a review note of 20 to 2,000 characters.' };
  }
  if (values.action === 'resume' && values.confirm !== 'RESUME') {
    return { success: false as const, error: 'Confirm that eligible erasure should resume before submitting.' };
  }
  const { data, error } = await serviceClient().rpc('triniti_admin_erasure_review', {
    p_actor_id: admin.id, p_session_id: admin.sessionId, p_key: values.command_key,
    p_source: values.source, p_request_id: values.request_id, p_version: values.version,
    p_action: values.action, p_note: note, p_confirm: values.action === 'resume' ? 'RESUME' : null,
  });
  if (isMissingAdminRpc(error, 'triniti_admin_erasure_review')) {
    return { success: false as const, error: 'Operator review is unavailable on this deployment. No review action was made.' };
  }
  if (error) {
    const messages: Record<string, string> = {
      ACTIVE_ADMIN_SESSION_REQUIRED: 'Sign in again to review this request.',
      ADMIN_PERMISSION_DENIED: 'Your current staff role cannot review account erasure.',
      COMMAND_KEY_REUSED: 'This retry belongs to different details. Reload the request.',
      TARGET_NOT_FOUND: 'This request no longer exists. Reload the queue.',
      ERASURE_REVIEW_STALE: 'This request changed while you were reviewing it. Reload it before continuing.',
      ERASURE_NOT_REVIEWABLE: 'This request is no longer awaiting review. Reload its current progress.',
      ERASURE_WORKER_ACTIVE: 'An erasure worker is still processing this request. Reload its progress.',
      ERASURE_ACCOUNT_NOT_DISABLED: 'The account is not safely disabled. Investigate its sign-in state before resuming.',
      ERASURE_WORKER_UNAVAILABLE: 'The erasure worker is unavailable. Restore worker health before resuming.',
      ERASURE_RESUME_CONFIRMATION_REQUIRED: 'Confirm that eligible erasure should resume before submitting.',
      INVALID_ERASURE_REVIEW: 'The review details are invalid. Reload the request.',
    };
    return { success: false as const, error: messages[error.message] || 'The review was not confirmed. Keep the same details and retry.' };
  }
  const matched = data?.success === true && data.command_key === values.command_key && data.source === values.source
    && data.request_id === values.request_id && /^[0-9a-f]{32}$/.test(data.version || '') && STATES.has(data.state);
  const validOutcome = values.action === 'note' ? data?.outcome === 'noted'
    : (data?.outcome === 'queued' && data.state === 'queued')
      || (data?.outcome === 'identity_pending' && data.state === 'identity_pending')
      || (data?.outcome === 'held' && data.state === 'retention_review' && Object.hasOwn(ERASURE_HOLDS, data.hold_reason));
  if (!matched || !validOutcome) return { success: false as const, error: 'The review result was not confirmed. Keep the same details and retry.' };
  const message = data.outcome === 'noted' ? 'Review note saved. Erasure state was not changed.'
    : data.outcome === 'held' ? `Review recorded. ${ERASURE_HOLDS[data.hold_reason]} Erasure remains on hold.`
      : data.outcome === 'identity_pending' ? 'Identity deletion has been queued for another worker attempt. Erasure is not complete.'
        : 'Eligible erasure has been queued. Completion will appear only after stored files and the account identity are verified absent.';
  return { success: true as const, message };
}
