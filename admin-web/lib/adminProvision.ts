import 'server-only';
import { createHmac, randomUUID } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { requirePermission } from './adminAuth';
import { serviceClient } from './supabaseAdmin';
import { isMissingAdminRpc } from './adminRpcAvailability';

const failure = (error: string) => ({ success: false as const, error });
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function provisionAccount(kind: 'staff' | 'business', form: FormData) {
  const admin = await requirePermission(kind === 'staff' ? 'staff_manage' : 'business_manage');
  const key = String(form.get('command_key') || '');
  if (!uuid.test(key)) return failure('Reload the form before submitting.');
  const password = String(form.get('password') || '');
  if (kind === 'staff' && (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72)) {
    return failure('Use a password with at least 12 characters and no more than 72 UTF-8 bytes.');
  }
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return failure('Account provisioning is unavailable. Contact the platform administrator.');
  const payload = kind === 'staff' ? {
    email: String(form.get('email') || '').trim().toLowerCase(),
    role: String(form.get('role') || ''),
    password_digest: createHmac('sha256', secret).update(password).digest('hex'),
  } : { id: String(form.get('id') || '') };
  const svc = serviceClient();
  const args = { p_actor_id: admin.id, p_session_id: admin.sessionId, p_key: key, p_kind: kind, p_payload: payload };
  const reserved = await svc.rpc('triniti_admin_provision', { ...args, p_phase: 'reserve' });
  if (isMissingAdminRpc(reserved.error, 'triniti_admin_provision')) {
    return failure('Account setup is unavailable on this deployment. No account was created. Contact the platform administrator.');
  }
  if (reserved.error || reserved.data?.success !== true) {
    const errors: Record<string, string> = {
      EMAIL_ALREADY_IN_USE: 'This email already has an account. Use the staff desk to manage existing staff.',
      USERNAME_ALREADY_IN_USE: 'That business username is already taken. Update the application before approving it.',
      APPLICATION_NOT_PENDING: 'This business application has already been reviewed.',
      BUSINESS_OWNER_REQUIRED: 'The business application needs an active account owner.',
      COMMAND_KEY_REUSED: 'These details differ from the original request. Restore them to finish the original request.',
      ACTIVE_ADMIN_SESSION_REQUIRED: 'Sign in and complete two-factor verification again.',
    };
    return failure(errors[reserved.error?.message || ''] || 'Provisioning could not be reserved. Retry the original form details.');
  }
  const job = reserved.data;
  if (job.complete === true) return { success: true as const };
  if (!uuid.test(job.auth_user_id || '') || !uuid.test(job.provision_id || '') || typeof job.email !== 'string') {
    return failure('The provisioning reservation was incomplete. Contact the platform administrator.');
  }
  const matches = (user: User | null) => user !== null && user.id === job.auth_user_id
    && user.app_metadata.triniti_provision_id === job.provision_id
    && user.email?.toLowerCase() === job.email;
  const existing = await svc.auth.admin.getUserById(job.auth_user_id);
  if (existing.data.user) {
    if (!matches(existing.data.user)) return failure('The reserved identity requires review.');
  } else {
    if (existing.error && existing.error.status !== 404) return failure('The reserved identity could not be checked. Retry.');
    const created = await svc.auth.admin.createUser({
      id: job.auth_user_id, email: job.email,
      password: kind === 'staff' ? password : randomUUID() + randomUUID(),
      email_confirm: true, app_metadata: { triniti_provision_id: job.provision_id },
    });
    if (created.error || !matches(created.data.user)) {
      // Another submission may have created this exact reserved identity while
      // this request was in flight. Never adopt an unrelated existing account.
      const retried = await svc.auth.admin.getUserById(job.auth_user_id);
      if (retried.error || !matches(retried.data.user)) return failure('Account creation was not confirmed. Retry the same details.');
    }
  }
  const finished = await svc.rpc('triniti_admin_provision', { ...args, p_phase: 'finish' });
  if (isMissingAdminRpc(finished.error, 'triniti_admin_provision')) {
    return failure('Account setup is unavailable on this deployment. The reserved account identity may already exist. Keep the same form details and contact the platform administrator to complete setup.');
  }
  if (finished.error || finished.data?.success !== true || finished.data?.complete !== true) {
    return failure('Account setup is pending. Retry the same details to finish it.');
  }
  return { success: true as const };
}
