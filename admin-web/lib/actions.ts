'use server';
/**
 * The desk's verbs. Every mutation writes the immutable audit log with the
 * acting admin, the target, the reason, and the before and after states.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { anonClient, serviceClient } from '@/lib/supabaseAdmin';
import { getAdmin, VERIFICATION_ROLES } from '@/lib/adminAuth';

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) redirect('/?error=' + encodeURIComponent('Sign in failed'));
  const svc = serviceClient();
  const { data: row } = await svc.from('admin_users')
    .select('role, active').eq('user_id', data.user!.id).maybeSingle();
  if (!row || !row.active) redirect('/?error=' + encodeURIComponent('This account is not an administrator'));
  (await cookies()).set('pc_admin_token', data.session.access_token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 8, path: '/',
  });
  redirect('/queue');
}

export async function signOut() {
  (await cookies()).delete('pc_admin_token');
  redirect('/');
}

async function requireReviewer() {
  const admin = await getAdmin();
  if (!admin || !VERIFICATION_ROLES.has(admin.role)) redirect('/');
  return admin!;
}

export async function approveApplication(formData: FormData) {
  const admin = await requireReviewer();
  const id = String(formData.get('id') || '');
  const svc = serviceClient();
  const { data: app } = await svc.from('verification_applications').select('*').eq('id', id).maybeSingle();
  if (!app || (app.status !== 'submitted' && app.status !== 'under_review')) redirect('/queue');
  const { data: before } = await svc.from('profiles')
    .select('verified_tier, verified_category, is_verified').eq('id', app.applicant_id).maybeSingle();
  await svc.from('verification_applications').update({
    status: 'approved', reviewer_id: admin.id, decided_at: new Date().toISOString(),
  }).eq('id', id);
  await svc.from('profiles').update({
    verified_tier: app.tier, verified_category: app.category, is_verified: true,
  }).eq('id', app.applicant_id);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'verification.approve', target_kind: 'profile', target_id: app.applicant_id,
    reason: 'Application ' + id + ' approved',
    before: before ?? {}, after: { verified_tier: app.tier, verified_category: app.category, is_verified: true },
  });
  revalidatePath('/queue');
}

export async function rejectApplication(formData: FormData) {
  const admin = await requireReviewer();
  const id = String(formData.get('id') || '');
  const reason = String(formData.get('reason') || '').trim() || 'Did not meet the bar at this time.';
  const svc = serviceClient();
  const { data: app } = await svc.from('verification_applications').select('*').eq('id', id).maybeSingle();
  if (!app || (app.status !== 'submitted' && app.status !== 'under_review')) redirect('/queue');
  await svc.from('verification_applications').update({
    status: 'rejected', reviewer_id: admin.id, decided_at: new Date().toISOString(), decision_reason: reason,
  }).eq('id', id);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'verification.reject', target_kind: 'verification_application', target_id: id,
    reason, before: { status: app.status }, after: { status: 'rejected' },
  });
  revalidatePath('/queue');
}
export async function suspendUser(formData: FormData) {
  const admin = await requireReviewer();
  const id = String(formData.get('id') || '');
  const reason = String(formData.get('reason') || '').trim();
  if (!id || !reason) redirect('/users');
  const svc = serviceClient();
  const { data: before } = await svc.from('profiles').select('deactivated_at, suspended_reason').eq('id', id).maybeSingle();
  await svc.from('profiles').update({
    deactivated_at: new Date().toISOString(), suspended_reason: reason, suspended_by: admin.id,
  }).eq('id', id);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'user.suspend', target_kind: 'profile', target_id: id,
    reason, before: before ?? {}, after: { deactivated: true, suspended_reason: reason },
  });
  revalidatePath('/users');
}

export async function restoreUser(formData: FormData) {
  const admin = await requireReviewer();
  const id = String(formData.get('id') || '');
  if (!id) redirect('/users');
  const svc = serviceClient();
  const { data: before } = await svc.from('profiles').select('deactivated_at, suspended_reason').eq('id', id).maybeSingle();
  await svc.from('profiles').update({
    deactivated_at: null, suspended_reason: null, suspended_by: null,
  }).eq('id', id);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'user.restore', target_kind: 'profile', target_id: id,
    reason: 'Account restored', before: before ?? {}, after: { deactivated: false },
  });
  revalidatePath('/users');
}

export async function revokeVerification(formData: FormData) {
  const admin = await requireReviewer();
  const id = String(formData.get('id') || '');
  if (!id) redirect('/users');
  const svc = serviceClient();
  const { data: before } = await svc.from('profiles').select('verified_tier, verified_category, is_verified').eq('id', id).maybeSingle();
  await svc.from('profiles').update({
    verified_tier: null, verified_category: null, is_verified: false,
  }).eq('id', id);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'verification.revoke', target_kind: 'profile', target_id: id,
    reason: 'Badge revoked', before: before ?? {}, after: { verified_tier: null, is_verified: false },
  });
  revalidatePath('/users');
}
