import 'server-only';
import { requirePermission } from './adminAuth';
import { serviceClient } from './supabaseAdmin';
import type { Permission } from './permissions';
import { isMissingAdminRpc } from './adminRpcAvailability';

export async function runAdminCommand(operation: string, permission: Permission, form: FormData) {
  if (operation === 'dismissReport') permission = form.get('table') === 'listing_reports' ? 'report_listing' : 'report_post';
  const admin = await requirePermission(permission);
  const key = String(form.get('command_key') || '');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key)) throw new Error('Reload the form before submitting.');
  const payload: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (name === 'command_key' || name.startsWith('$ACTION_')) continue;
    if (typeof value !== 'string' || Object.hasOwn(payload, name)) throw new Error('Invalid form fields.');
    payload[name] = value;
  }
  const { data, error } = await serviceClient().rpc('triniti_platinum_admin_command', {
    p_actor_id: admin.id, p_session_id: admin.sessionId, p_key: key, p_operation: operation, p_payload: payload,
  });
  if (isMissingAdminRpc(error, 'triniti_platinum_admin_command')) {
    return { success: false as const, error: 'This action is unavailable on this deployment. No change was made. Contact the platform administrator.' };
  }
  if (error || data?.success !== true || data?.command_key !== key) {
    const messages: Record<string, string> = {
      TARGET_NOT_FOUND: 'This record no longer exists.', APPLICATION_NOT_PENDING: 'This application has already been reviewed.',
      REPORT_NOT_OPEN: 'This report has already been resolved.', ACTIVE_ADMIN_SESSION_REQUIRED: 'Sign in again to continue.',
      REASON_REQUIRED: 'Enter a reason for this change.', LAST_SUPER_ADMIN: 'Keep at least one active super administrator.',
      TRANSFER_ORGANIZATION_OWNERSHIP_FIRST: 'Transfer organization ownership before deleting this account.',
      ACTIVE_STAFF_DELETION_FORBIDDEN: 'Deactivate this staff account through the staff desk first.',
      ADMIN_PERMISSION_DENIED: 'Your current staff role cannot perform this action.',
      COMMAND_KEY_REUSED: 'This retry belongs to different details. Reload the form before continuing.',
      REPORT_TARGET_MISMATCH: 'The report no longer matches this content. Reload the report.',
      APPLICATION_PROVISIONING: 'Account creation is in progress. Complete the original approval.',
      DELETION_REVIEW_REQUIRED: 'This account is awaiting deletion review and cannot be restored here.',
      INVALID_COMMAND_FIELD: 'The form has changed. Reload it before submitting.',
    };
    return { success: false as const, error: messages[error?.message || ''] || 'The change was not confirmed. Keep the same details and retry.' };
  }
  return { ...data, success: true as const, message: data.deletion_status === 'retention_review' ? 'Sign-in disabled. The deletion request is awaiting retention review; erasure is not yet complete.' : undefined };
}
