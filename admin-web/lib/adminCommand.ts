import 'server-only';
import { cookies } from 'next/headers';
import { requirePermission } from './adminAuth';
import { serviceClient } from './supabaseAdmin';
import type { Permission } from './permissions';

export async function runAdminCommand(operation: string, permission: Permission, form: FormData) {
  if (operation === 'dismissReport') permission = form.get('table') === 'listing_reports' ? 'report_listing' : 'report_post';
  const admin = await requirePermission(permission);
  const token = (await cookies()).get('pc_admin_token')?.value;
  if (!token) throw new Error('Sign in again to continue.');
  // requirePermission verified this token with Auth and the native session check.
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const key = String(form.get('command_key') || '');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key)) throw new Error('Reload the form before submitting.');
  const payload: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (name === 'command_key' || name.startsWith('$ACTION_')) continue;
    if (typeof value !== 'string' || Object.hasOwn(payload, name)) throw new Error('Invalid form fields.');
    payload[name] = value;
  }
  const { data, error } = await serviceClient().rpc('triniti_platinum_admin_command', {
    p_actor_id: admin.id, p_session_id: claims.session_id, p_key: key, p_operation: operation, p_payload: payload,
  });
  if (error || data?.success !== true || data?.command_key !== key) {
    const messages: Record<string, string> = {
      TARGET_NOT_FOUND: 'This record no longer exists.', APPLICATION_NOT_PENDING: 'This application has already been reviewed.',
      REPORT_NOT_OPEN: 'This report has already been resolved.', ACTIVE_ADMIN_SESSION_REQUIRED: 'Sign in again to continue.',
      REASON_REQUIRED: 'Enter a reason for this change.', LAST_SUPER_ADMIN: 'Keep at least one active super administrator.',
      TRANSFER_ORGANIZATION_OWNERSHIP_FIRST: 'Transfer organization ownership before deleting this account.',
      ACTIVE_STAFF_DELETION_FORBIDDEN: 'Deactivate this staff account through the staff desk first.',
    };
    throw new Error(messages[error?.message || ''] || 'The change was not confirmed. Keep the same details and retry.');
  }
  return data;
}
