'use server';
/**
 * The desk's verbs. Every mutation writes the immutable audit log with the
 * acting admin, the target, the reason, and the before and after states.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { anonClient, serviceClient } from '@/lib/supabaseAdmin';
import { getAdmin, VERIFICATION_ROLES, ADS_ROLES } from '@/lib/adminAuth';

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
  const { data: before } = await svc.from('marketplace_listings').select('id, seller_id, title, price').eq('id', lid).maybeSingle();
  await svc.from('marketplace_listings').delete().eq('id', lid);
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

export async function adminRemovePost(formData: FormData) {
  const admin = await requireReviewer();
  const pid = String(formData.get('pid') || '');
  if (!pid) redirect('/content');
  const svc = serviceClient();
  const { data: before } = await svc.from('posts').select('id, user_id, content, body').eq('id', pid).maybeSingle();
  await svc.from('posts').delete().eq('id', pid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'content.remove_post', target_kind: 'post', target_id: pid,
    reason: 'Removed from the content desk', before: before ?? {}, after: { deleted: true },
  });
  revalidatePath('/content');
}

export async function adminRemoveListing(formData: FormData) {
  const admin = await requireReviewer();
  const lid = String(formData.get('lid') || '');
  if (!lid) redirect('/market');
  const svc = serviceClient();
  const { data: before } = await svc.from('marketplace_listings').select('id, seller_id, title, price').eq('id', lid).maybeSingle();
  await svc.from('marketplace_listings').delete().eq('id', lid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'market.remove_listing', target_kind: 'listing', target_id: lid,
    reason: 'Removed from the market desk', before: before ?? {}, after: { deleted: true },
  });
  revalidatePath('/market');
}

export async function resolveTicket(formData: FormData) {
  const admin = await requireReviewer();
  const rid = String(formData.get('rid') || '');
  const note = String(formData.get('note') || '').trim();
  if (!rid || !note) redirect('/support');
  const svc = serviceClient();
  const { data: t } = await svc.from('support_tickets').select('id, user_id, kind, subject, status').eq('id', rid).maybeSingle();
  if (!t || t.status !== 'open') redirect('/support');
  await svc.from('support_tickets').update({
    status: 'resolved', resolution_note: note, resolved_by: admin.id, resolved_at: new Date().toISOString(),
  }).eq('id', rid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: t.kind === 'appeal' ? 'appeal.resolve' : 'support.resolve',
    target_kind: 'support_ticket', target_id: rid, reason: note,
    before: { status: 'open' }, after: { status: 'resolved' },
  });
  revalidatePath('/support');
}

async function requireAdsReviewer() {
  const admin = await getAdmin();
  if (!admin || !ADS_ROLES.has(admin.role)) redirect('/');
  return admin!;
}

export async function approveCampaign(formData: FormData) {
  const admin = await requireAdsReviewer();
  const id = String(formData.get('id') || '');
  const paidRaw = String(formData.get('paid_amount') || '').trim();
  const paymentRef = String(formData.get('payment_ref') || '').trim();
  const svc = serviceClient();
  const { data: c } = await svc.from('studio_campaigns').select('*').eq('id', id).maybeSingle();
  if (!c || c.status !== 'submitted') redirect('/ads');
  const { error } = await svc.rpc('admin_review_campaign', {
    p_id: id, p_approve: true, p_note: null,
    p_paid_amount: paidRaw ? Number(paidRaw) : null, p_payment_ref: paymentRef || null,
  });
  if (error) redirect('/ads');
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'campaign.approve', target_kind: 'studio_campaign', target_id: id,
    reason: 'Campaign ' + id + ' approved' + (paymentRef ? ' - ref ' + paymentRef : ''),
    before: { status: c.status }, after: { status: 'approved', paid_amount: paidRaw || c.paid_amount, payment_ref: paymentRef || c.payment_ref },
  });
  revalidatePath('/ads');
}

export async function rejectCampaign(formData: FormData) {
  const admin = await requireAdsReviewer();
  const id = String(formData.get('id') || '');
  const reason = String(formData.get('reason') || '').trim() || 'Did not meet the advertising guidelines.';
  const svc = serviceClient();
  const { data: c } = await svc.from('studio_campaigns').select('status').eq('id', id).maybeSingle();
  if (!c || c.status !== 'submitted') redirect('/ads');
  const { error } = await svc.rpc('admin_review_campaign', { p_id: id, p_approve: false, p_note: reason, p_paid_amount: null, p_payment_ref: null });
  if (error) redirect('/ads');
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'campaign.reject', target_kind: 'studio_campaign', target_id: id,
    reason, before: { status: c.status }, after: { status: 'rejected' },
  });
  revalidatePath('/ads');
}

export async function adminEndCampaign(formData: FormData) {
  const admin = await requireAdsReviewer();
  const id = String(formData.get('id') || '');
  const svc = serviceClient();
  const { data: c } = await svc.from('studio_campaigns').select('status').eq('id', id).maybeSingle();
  if (!c || !['live', 'paused', 'approved'].includes(c.status)) redirect('/ads');
  await svc.from('studio_campaigns').update({ status: 'ended', updated_at: new Date().toISOString() }).eq('id', id);
  await svc.from('promoted_posts').update({ status: 'ended' }).eq('campaign_id', id).in('status', ['active', 'paused']);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'campaign.end', target_kind: 'studio_campaign', target_id: id,
    reason: 'Ended from the desk', before: { status: c.status }, after: { status: 'ended' },
  });
  revalidatePath('/ads');
}

const STAFF_ROLES = new Set(['super_admin', 'platform_admin', 'trust_safety', 'support_agent', 'ops_engineer', 'market_reviewer', 'jobs_reviewer', 'verification_reviewer', 'finance_admin', 'analyst', 'auditor_readonly']);

async function requireSuper() {
  const admin = await getAdmin();
  if (!admin || admin.role !== 'super_admin') redirect('/dashboard');
  return admin!;
}

export async function inviteStaff(formData: FormData) {
  const admin = await requireSuper();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const role = String(formData.get('role') || '');
  if (!email || password.length < 10 || !STAFF_ROLES.has(role)) redirect('/staff');
  const svc = serviceClient();
  let uid: string | null = null;
  const { data: created, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    uid = ((list?.users ?? []).find((u: any) => u.email === email) as any)?.id ?? null;
  } else { uid = created.user?.id ?? null; }
  if (!uid) redirect('/staff');
  const handle = 'ops_' + email.split('@')[0].replace(/[^a-z0-9]/g, '').slice(0, 12) + '_' + uid.slice(0, 4);
  await svc.from('profiles').upsert({
    id: uid, username: handle, full_name: 'Platinum Circles Staff', account_type: 'personal',
    deactivated_at: new Date().toISOString(),
  }, { onConflict: 'id', ignoreDuplicates: true });
  await svc.from('admin_users').upsert({ user_id: uid, role, active: true }, { onConflict: 'user_id' });
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'staff.invite', target_kind: 'admin_user', target_id: uid,
    reason: 'Invited as ' + role, before: {}, after: { role, active: true },
  });
  revalidatePath('/staff');
}

export async function setStaffRole(formData: FormData) {
  const admin = await requireSuper();
  const uid = String(formData.get('uid') || '');
  const role = String(formData.get('role') || '');
  if (!uid || !STAFF_ROLES.has(role)) redirect('/staff');
  const svc = serviceClient();
  const { data: before } = await svc.from('admin_users').select('role').eq('user_id', uid).maybeSingle();
  await svc.from('admin_users').update({ role }).eq('user_id', uid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'staff.set_role', target_kind: 'admin_user', target_id: uid,
    reason: 'Role set to ' + role, before: before ?? {}, after: { role },
  });
  revalidatePath('/staff');
}

export async function deactivateStaff(formData: FormData) {
  const admin = await requireSuper();
  const uid = String(formData.get('uid') || '');
  if (!uid || uid === admin.id) redirect('/staff');
  const svc = serviceClient();
  await svc.from('admin_users').update({ active: false }).eq('user_id', uid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'staff.deactivate', target_kind: 'admin_user', target_id: uid,
    reason: 'Keys removed', before: { active: true }, after: { active: false },
  });
  revalidatePath('/staff');
}

export async function issueStrike(formData: FormData) {
  const admin = await requireReviewer();
  const uid = String(formData.get('uid') || '');
  const level = String(formData.get('level') || '');
  const reason = String(formData.get('reason') || '').trim();
  const days = parseInt(String(formData.get('days') || '0'), 10) || 0;
  if (!uid || !reason || !['warn', 'restrict', 'suspend', 'ban'].includes(level)) redirect('/users');
  const svc = serviceClient();
  const expires = level === 'restrict' && days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  await svc.from('member_strikes').insert({ user_id: uid, level, reason, issued_by: admin.id, expires_at: expires });
  if (level === 'restrict' && expires) {
    await svc.from('profiles').update({ restricted_until: expires }).eq('id', uid);
  }
  if (level === 'suspend' || level === 'ban') {
    await svc.from('profiles').update({
      deactivated_at: new Date().toISOString(), suspended_reason: reason, suspended_by: admin.id,
    }).eq('id', uid);
  }
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'enforcement.' + level, target_kind: 'profile', target_id: uid,
    reason, before: {}, after: { level, expires_at: expires },
  });
  revalidatePath('/users/' + uid);
  revalidatePath('/users');
}

export async function liftRestriction(formData: FormData) {
  const admin = await requireReviewer();
  const uid = String(formData.get('uid') || '');
  if (!uid) redirect('/users');
  const svc = serviceClient();
  await svc.from('profiles').update({ restricted_until: null }).eq('id', uid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'enforcement.lift_restriction', target_kind: 'profile', target_id: uid,
    reason: 'Restriction lifted early', before: {}, after: { restricted_until: null },
  });
  revalidatePath('/users/' + uid);
}

export async function adminRemoveStory(formData: FormData) {
  const admin = await requireReviewer();
  const sid = String(formData.get('sid') || '');
  if (!sid) redirect('/stories');
  const svc = serviceClient();
  const { data: before } = await svc.from('stories').select('id, user_id, media_type, caption').eq('id', sid).maybeSingle();
  await svc.from('stories').delete().eq('id', sid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'content.remove_story', target_kind: 'story', target_id: sid,
    reason: 'Removed from the stories desk', before: before ?? {}, after: { deleted: true },
  });
  revalidatePath('/stories');
  revalidatePath('/content');
}

export async function toggleFlag(formData: FormData) {
  const admin = await requireReviewer();
  const key = String(formData.get('key') || '');
  const to = String(formData.get('to') || '') === 'on';
  if (!key) redirect('/system');
  const svc = serviceClient();
  await svc.from('feature_flags').update({ enabled: to, updated_by: admin.id, updated_at: new Date().toISOString() }).eq('key', key);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'system.flag.' + (to ? 'on' : 'off'), target_kind: 'feature_flag', target_id: key,
    reason: 'Flag ' + key + ' switched ' + (to ? 'on' : 'off'), before: { enabled: !to }, after: { enabled: to },
  });
  revalidatePath('/system');
}

export async function publishAnnouncement(formData: FormData) {
  const admin = await requireReviewer();
  const title = String(formData.get('title') || '').trim();
  const body = String(formData.get('body') || '').trim();
  if (!title || !body) redirect('/system');
  const svc = serviceClient();
  const { data: row } = await svc.from('announcements').insert({ title, body, created_by: admin.id }).select('id').maybeSingle();
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'system.announce', target_kind: 'announcement', target_id: row?.id ?? 'unknown',
    reason: title, before: {}, after: { title, body },
  });
  revalidatePath('/system');
}

export async function retireAnnouncement(formData: FormData) {
  const admin = await requireReviewer();
  const id = String(formData.get('id') || '');
  if (!id) redirect('/system');
  const svc = serviceClient();
  await svc.from('announcements').update({ active: false }).eq('id', id);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'system.announce.retire', target_kind: 'announcement', target_id: id,
    reason: 'Announcement retired', before: { active: true }, after: { active: false },
  });
  revalidatePath('/system');
}

export async function addBlockedWord(formData: FormData) {
  const admin = await requireReviewer();
  const word = String(formData.get('word') || '').trim().toLowerCase();
  if (!word || word.length < 2) redirect('/system');
  const svc = serviceClient();
  await svc.from('blocked_words').upsert({ word, added_by: admin.id }, { onConflict: 'word', ignoreDuplicates: true });
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'system.block_word', target_kind: 'blocked_word', target_id: word,
    reason: 'Word added to the blocklist', before: {}, after: { word },
  });
  revalidatePath('/system');
}

export async function removeBlockedWord(formData: FormData) {
  const admin = await requireReviewer();
  const word = String(formData.get('word') || '');
  if (!word) redirect('/system');
  const svc = serviceClient();
  await svc.from('blocked_words').delete().eq('word', word);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'system.unblock_word', target_kind: 'blocked_word', target_id: word,
    reason: 'Word removed from the blocklist', before: { word }, after: {},
  });
  revalidatePath('/system');
}

export async function approveBusinessApplication(formData: FormData) {
  const admin = await requireSuper();
  const id = String(formData.get('id') || '');
  if (!id) redirect('/businesses');
  const svc = serviceClient();
  const { data: app } = await svc.from('business_applications').select('*').eq('id', id).maybeSingle();
  if (!app || app.status !== 'submitted') redirect('/businesses');
  const email = 'biz-' + crypto.randomUUID() + '@biz.platinumcircles.app';
  const password = crypto.randomUUID() + crypto.randomUUID();
  const { data: created, error: cErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  const bizId = created?.user?.id;
  if (cErr || !bizId) redirect('/businesses');
  try {
    const { error: fErr } = await svc.rpc('finalise_business', {
      p_business_id: bizId,
      p_name: app.company_name,
      p_username: app.desired_username,
      p_category: app.category || '',
      p_owner_id: app.applicant_id ?? bizId,
    });
    if (fErr) throw fErr;
    await svc.from('profiles').update({
      is_verified: true, verified_tier: 'business', verified_category: app.category || 'Business',
    }).eq('id', bizId);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rnd = new Uint8Array(8); crypto.getRandomValues(rnd);
    let raw = ''; rnd.forEach(b => { raw += alphabet[b % alphabet.length]; });
    const setupCode = raw.slice(0, 4) + '-' + raw.slice(4);
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(setupCode.toUpperCase()));
    const codeHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    await svc.from('business_access_members').insert({ business_id: bizId, display_name: 'Primary access', role: 'owner', code_hash: codeHash });
    await svc.from('business_applications').update({
      status: 'approved', decided_by: admin.id, decided_at: new Date().toISOString(),
      decision_reason: 'Approved - @' + app.desired_username + ' is live with the space-grey seal. Setup code: ' + setupCode + ' - sign in with Business sign-in on your company device. The first device is trusted automatically; manage people and devices from Settings, Business access inside the business account.',
    }).eq('id', id);
    await svc.from('admin_audit_log').insert({
      admin_id: admin.id, action: 'business.approve', target_kind: 'business_application', target_id: id,
      reason: app.company_name + ' approved as @' + app.desired_username, before: { status: 'submitted' }, after: { status: 'approved', business_id: bizId },
    });
  } catch {
    await svc.auth.admin.deleteUser(bizId).catch(() => {});
    redirect('/businesses');
  }
  revalidatePath('/businesses');
}

export async function rejectBusinessApplication(formData: FormData) {
  const admin = await requireSuper();
  const id = String(formData.get('id') || '');
  const reason = String(formData.get('reason') || '').trim();
  if (!id || !reason) redirect('/businesses');
  const svc = serviceClient();
  await svc.from('business_applications').update({
    status: 'rejected', decision_reason: reason, decided_by: admin.id, decided_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'submitted');
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'business.reject', target_kind: 'business_application', target_id: id,
    reason, before: { status: 'submitted' }, after: { status: 'rejected' },
  });
  revalidatePath('/businesses');
}
export async function sendTicketReply(formData: FormData) {
  const admin = await requireReviewer();
  const tid = String(formData.get('tid') || '');
  const body = String(formData.get('body') || '').trim();
  if (!tid || !body) redirect('/support');
  const svc = serviceClient();
  const { data: t } = await svc.from('support_tickets').select('id, status, kind').eq('id', tid).maybeSingle();
  if (!t) redirect('/support');
  await svc.from('support_messages').insert({ ticket_id: tid, sender: 'ops', sender_id: admin.id, body });
  await svc.from('support_tickets').update({ status: t.status === 'solved' ? 'solved' : 'pending', updated_at: new Date().toISOString() }).eq('id', tid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: t.kind === 'appeal' ? 'appeal.reply' : 'support.reply',
    target_kind: 'support_ticket', target_id: tid, reason: body.slice(0, 200),
    before: { status: t.status }, after: { status: t.status === 'solved' ? 'solved' : 'pending' },
  });
  revalidatePath('/support/' + tid); revalidatePath('/support');
}

export async function setTicketStatus(formData: FormData) {
  const admin = await requireReviewer();
  const tid = String(formData.get('tid') || '');
  const status = String(formData.get('status') || '');
  if (!tid || !['open', 'pending', 'solved'].includes(status)) redirect('/support');
  const svc = serviceClient();
  const { data: t } = await svc.from('support_tickets').select('id, status, kind').eq('id', tid).maybeSingle();
  if (!t) redirect('/support');
  await svc.from('support_tickets').update({
    status, updated_at: new Date().toISOString(),
    resolved_by: status === 'solved' ? admin.id : null,
    resolved_at: status === 'solved' ? new Date().toISOString() : null,
  }).eq('id', tid);
  await svc.from('admin_audit_log').insert({
    admin_id: admin.id, action: 'support.status', target_kind: 'support_ticket', target_id: tid,
    reason: status, before: { status: t.status }, after: { status },
  });
  revalidatePath('/support/' + tid); revalidatePath('/support');
}



// ---- Organizations desk ---------------------------------------------------

export async function archiveOrganization(formData: FormData) {
  const admin = await requireSuper();
  const id = String(formData.get('id') || '');
  if (!id) redirect('/organizations');
  const svc = serviceClient();
  await svc.from('organizations').update({ archived_at: new Date().toISOString() }).eq('id', id);
  await svc.from('admin_audit_log').insert({ admin_id: admin.id, action: 'organization.archive', target_kind: 'organization', target_id: id, reason: 'Archived from the Organizations desk', before: {}, after: { archived: true } });
  await svc.from('org_audit_log').insert({ org_id: id, actor_id: admin.id, action: 'archived_by_platform', target_type: 'organization', target_id: id });
  redirect('/organizations?show=archived');
}

export async function restoreOrganization(formData: FormData) {
  const admin = await requireSuper();
  const id = String(formData.get('id') || '');
  if (!id) redirect('/organizations');
  const svc = serviceClient();
  await svc.from('organizations').update({ archived_at: null }).eq('id', id);
  await svc.from('admin_audit_log').insert({ admin_id: admin.id, action: 'organization.restore', target_kind: 'organization', target_id: id, reason: 'Restored from the Organizations desk', before: { archived: true }, after: {} });
  await svc.from('org_audit_log').insert({ org_id: id, actor_id: admin.id, action: 'restored_by_platform', target_type: 'organization', target_id: id });
  redirect('/organizations');
}

// Ownership changes hands when a business is sold or an owner leaves; the
// platform can force it when the organization cannot do it itself.
export async function adminTransferOwnership(formData: FormData) {
  const admin = await requireSuper();
  const id = String(formData.get('id') || '');
  const username = String(formData.get('username') || '').trim().replace(/^@/, '').toLowerCase();
  if (!id || !username) redirect('/organizations');
  const svc = serviceClient();
  const { data: p } = await svc.from('profiles').select('id').ilike('username', username).maybeSingle();
  if (!p) redirect('/organizations?q=' + encodeURIComponent(username));
  const { data: before } = await svc.from('org_memberships').select('user_id').eq('org_id', id).eq('role', 'owner');
  await svc.from('org_memberships').update({ role: 'admin' }).eq('org_id', id).eq('role', 'owner');
  await svc.from('org_memberships').upsert({ org_id: id, user_id: p.id, role: 'owner', expires_at: null }, { onConflict: 'org_id,user_id' });
  await svc.from('admin_audit_log').insert({ admin_id: admin.id, action: 'organization.transfer_ownership', target_kind: 'organization', target_id: id, reason: 'Ownership set to @' + username, before: { owners: (before ?? []).map((b) => b.user_id) }, after: { owner: p.id } });
  await svc.from('org_audit_log').insert({ org_id: id, actor_id: admin.id, action: 'ownership_set_by_platform', target_type: 'user', target_id: p.id });
  redirect('/organizations');
}


// Permanent deletion. delete_user_account removes everything the person owns
// (posts, media rows, messages, follows, stories, listings, memberships) and
// finally the auth user, in one transaction. There is no undo.
export async function adminDeleteAccount(formData: FormData) {
  const admin = await requireSuper();
  const id = String(formData.get('id') || '');
  const reason = String(formData.get('reason') || '').trim();
  const confirm = String(formData.get('confirm') || '').trim().toUpperCase();
  if (!id || !reason || confirm !== 'DELETE') redirect('/users?id=' + id);
  const svc = serviceClient();
  const { data: before } = await svc.from('profiles').select('username, full_name, account_type').eq('id', id).maybeSingle();
  await svc.from('admin_audit_log').insert({ admin_id: admin.id, action: 'account.delete', target_kind: 'profile', target_id: id, reason, before: before ?? {}, after: {} });
  const { error } = await svc.rpc('delete_user_account', { p_user_id: id });
  if (error) {
    await svc.from('admin_audit_log').insert({ admin_id: admin.id, action: 'account.delete_failed', target_kind: 'profile', target_id: id, reason: error.message, before: {}, after: {} });
    redirect('/users?id=' + id + '&err=' + encodeURIComponent(error.message));
  }
  redirect('/users');
}

// Remove one comment. The post's counts are trigger-maintained.
export async function adminRemoveComment(formData: FormData) {
  const admin = await requireSuper();
  const id = String(formData.get('id') || '');
  const reason = String(formData.get('reason') || 'Removed by platform').trim();
  if (!id) redirect('/content');
  const svc = serviceClient();
  const { data: before } = await svc.from('post_comments').select('post_id, user_id, body, content').eq('id', id).maybeSingle();
  await svc.from('post_comments').delete().eq('id', id);
  await svc.from('admin_audit_log').insert({ admin_id: admin.id, action: 'comment.remove', target_kind: 'comment', target_id: id, reason, before: before ?? {}, after: {} });
  redirect('/content');
}
