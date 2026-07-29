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
  redirect('/dashboard');
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

export async function dismissReport(formData: FormData) {
  const admin = await requireReviewer();
  const rid = String(formData.get('rid') || '');
  const table = String(formData.get('table') || '');
  if (!rid || (table !== 'post_reports' && table !== 'listing_reports')) redirect('/reports');
  const svc = serviceClient();
  await svc.from(table).update({ status: 'dismissed', resolved_by: admin.id, resolved_at: new Date().toISOString() }).eq('id', rid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'report.dismiss', target_kind: table, target_id: rid,
    reason: 'No violation', before: { status: 'open' }, after: { status: 'dismissed' },
  });
  revalidatePath('/reports');
}

export async function removeReportedPost(formData: FormData) {
  const admin = await requireReviewer();
  const rid = String(formData.get('rid') || '');
  const pid = String(formData.get('pid') || '');
  if (!rid || !pid) redirect('/reports');
  const svc = serviceClient();
  const { data: before } = await svc.from('posts').select('id, user_id, content').eq('id', pid).maybeSingle();
  await svc.from('posts').delete().eq('id', pid);
  await svc.from('post_reports').update({ status: 'actioned', resolved_by: admin.id, resolved_at: new Date().toISOString() }).eq('id', rid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'content.remove_post', target_kind: 'post', target_id: pid,
    reason: 'Removed on report ' + rid, before: before ?? {}, after: { deleted: true },
  });
  revalidatePath('/reports');
}

export async function removeReportedListing(formData: FormData) {
  const admin = await requireReviewer();
  const rid = String(formData.get('rid') || '');
  const lid = String(formData.get('lid') || '');
  if (!rid || !lid) redirect('/reports');
  const svc = serviceClient();
  const { data: before } = await svc.from('listings').select('id, seller_id, title, price').eq('id', lid).maybeSingle();
  await svc.from('listings').delete().eq('id', lid);
  await svc.from('listing_reports').update({ status: 'actioned', resolved_by: admin.id, resolved_at: new Date().toISOString() }).eq('id', rid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'content.remove_listing', target_kind: 'listing', target_id: lid,
    reason: 'Removed on report ' + rid, before: before ?? {}, after: { deleted: true },
  });
  revalidatePath('/reports');
}

export async function resolveUserReport(formData: FormData) {
  const admin = await requireReviewer();
  const rid = String(formData.get('rid') || '');
  const outcome = String(formData.get('outcome') || '');
  if (!rid || (outcome !== 'actioned' && outcome !== 'dismissed')) redirect('/reports');
  const svc = serviceClient();
  await svc.from('user_reports').update({ status: outcome, resolved_by: admin.id, resolved_at: new Date().toISOString() }).eq('id', rid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'report.user.' + outcome, target_kind: 'user_reports', target_id: rid,
    reason: outcome === 'actioned' ? 'Actioned' : 'No violation', before: { status: 'open' }, after: { status: outcome },
  });
  revalidatePath('/reports');
}
