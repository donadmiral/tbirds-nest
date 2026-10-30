'use server';
/**
 * Server actions authenticate the active native session and check the action's
 * role policy. Database commands save their mutation, audit and retry receipt together.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { anonClient, serviceClient } from '@/lib/supabaseAdmin';
import { adminFromToken } from '@/lib/adminAuth';
import { provisionAccount } from '@/lib/adminProvision';
import { saveAdminSession } from '@/lib/adminSession';


import { runAdminCommand } from '@/lib/adminCommand';
export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  let session = null;
  let failure = 'credentials';
  try {
    const result = await anonClient().auth.signInWithPassword({ email, password });
    session = result.data.session;
    if (result.error && (!result.error.status || result.error.status >= 500)) failure = 'unavailable';
  } catch { failure = 'unavailable'; }
  if (!session) redirect('/?error=' + failure);
  let admin = null;
  try { admin = await adminFromToken(session.access_token); }
  catch { redirect('/?error=unavailable'); }
  if (!admin) {
    try { await serviceClient().auth.admin.signOut(session.access_token, 'local'); } catch { /* No admin session is persisted. */ }
    redirect('/?error=access');
  }
  await saveAdminSession(session);
  redirect('/dashboard');
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get('pc_admin_token')?.value;
  if (token) {
    const { error } = await serviceClient().auth.admin.signOut(token, 'local');
    if (error && error.status !== 401 && error.status !== 403 && error.status !== 404) {
      throw new Error('Sign out could not be confirmed. Try again.');
    }
  }
  jar.delete('pc_admin_token');
  jar.delete('pc_admin_refresh');
  redirect('/');
}

export async function approveApplication(formData: FormData) {
  const result = await runAdminCommand('approveApplication', 'verification', formData);
  if (!result.success) return result;
  revalidatePath('/queue');
  revalidatePath('/dashboard');
  return result;
}

export async function rejectApplication(formData: FormData) {
  const result = await runAdminCommand('rejectApplication', 'verification', formData);
  if (!result.success) return result;
  revalidatePath('/queue');
  revalidatePath('/dashboard');
  return result;
}

export async function suspendUser(formData: FormData) {
  const result = await runAdminCommand('suspendUser', 'user_moderate', formData);
  if (!result.success) return result;
  revalidatePath('/users');
  revalidatePath('/dashboard');
  return result;
}

export async function restoreUser(formData: FormData) {
  const result = await runAdminCommand('restoreUser', 'user_moderate', formData);
  if (!result.success) return result;
  revalidatePath('/users');
  revalidatePath('/dashboard');
  return result;
}

export async function revokeVerification(formData: FormData) {
  const result = await runAdminCommand('revokeVerification', 'verification', formData);
  if (!result.success) return result;
  revalidatePath('/users');
  revalidatePath('/dashboard');
  return result;
}

export async function dismissReport(formData: FormData) {
  const result = await runAdminCommand('dismissReport', 'report_post', formData);
  if (!result.success) return result;
  revalidatePath('/reports');
  revalidatePath('/dashboard');
  return result;
}

export async function removeReportedPost(formData: FormData) {
  const result = await runAdminCommand('removeReportedPost', 'report_post', formData);
  if (!result.success) return result;
  revalidatePath('/reports');
  revalidatePath('/dashboard');
  return result;
}

export async function removeReportedListing(formData: FormData) {
  const result = await runAdminCommand('removeReportedListing', 'report_listing', formData);
  if (!result.success) return result;
  revalidatePath('/reports');
  revalidatePath('/dashboard');
  return result;
}

export async function resolveUserReport(formData: FormData) {
  const result = await runAdminCommand('resolveUserReport', 'report_user', formData);
  if (!result.success) return result;
  revalidatePath('/reports');
  revalidatePath('/dashboard');
  return result;
}

export async function adminRemovePost(formData: FormData) {
  const result = await runAdminCommand('adminRemovePost', 'post_moderate', formData);
  if (!result.success) return result;
  revalidatePath('/content');
  revalidatePath('/content/[id]', 'page');
  revalidatePath('/dashboard');
  return result;
}

export async function adminRemoveListing(formData: FormData) {
  const result = await runAdminCommand('adminRemoveListing', 'market_moderate', formData);
  if (!result.success) return result;
  revalidatePath('/market');
  revalidatePath('/dashboard');
  return result;
}

export async function resolveTicket(formData: FormData) {
  const result = await runAdminCommand('resolveTicket', 'support', formData);
  if (!result.success) return result;
  revalidatePath('/support');
  revalidatePath('/dashboard');
  const tid = String(formData.get('tid') || formData.get('rid') || '');
  if (tid) revalidatePath('/support/' + tid);
  return result;
}

export async function approveCampaign(formData: FormData) {
  const result = await runAdminCommand('approveCampaign', 'ads', formData);
  if (!result.success) return result;
  revalidatePath('/ads');
  revalidatePath('/dashboard');
  return result;
}

export async function rejectCampaign(formData: FormData) {
  const result = await runAdminCommand('rejectCampaign', 'ads', formData);
  if (!result.success) return result;
  revalidatePath('/ads');
  revalidatePath('/dashboard');
  return result;
}

export async function adminEndCampaign(formData: FormData) {
  const result = await runAdminCommand('adminEndCampaign', 'ads', formData);
  if (!result.success) return result;
  revalidatePath('/ads');
  revalidatePath('/dashboard');
  return result;
}

export async function inviteStaff(formData: FormData) {
  const result = await provisionAccount('staff', formData);
  if (!result.success) return result;
  revalidatePath('/staff');
  return result;
}

export async function setStaffRole(formData: FormData) {
  const result = await runAdminCommand('setStaffRole', 'staff_manage', formData);
  if (!result.success) return result;
  revalidatePath('/staff');
  revalidatePath('/dashboard');
  return result;
}

export async function deactivateStaff(formData: FormData) {
  const result = await runAdminCommand('deactivateStaff', 'staff_manage', formData);
  if (!result.success) return result;
  revalidatePath('/staff');
  revalidatePath('/dashboard');
  return result;
}

export async function issueStrike(formData: FormData) {
  const result = await runAdminCommand('issueStrike', 'user_moderate', formData);
  if (!result.success) return result;
  revalidatePath('/users');
  revalidatePath('/dashboard');
  return result;
}

export async function liftRestriction(formData: FormData) {
  const result = await runAdminCommand('liftRestriction', 'user_moderate', formData);
  if (!result.success) return result;
  revalidatePath('/users');
  revalidatePath('/dashboard');
  return result;
}

export async function adminRemoveStory(formData: FormData) {
  const result = await runAdminCommand('adminRemoveStory', 'post_moderate', formData);
  if (!result.success) return result;
  revalidatePath('/stories');
  revalidatePath('/dashboard');
  return result;
}

export async function toggleFlag(formData: FormData) {
  const result = await runAdminCommand('toggleFlag', 'system', formData);
  if (!result.success) return result;
  revalidatePath('/system');
  revalidatePath('/dashboard');
  return result;
}

export async function publishAnnouncement(formData: FormData) {
  const result = await runAdminCommand('publishAnnouncement', 'system', formData);
  if (!result.success) return result;
  revalidatePath('/system');
  revalidatePath('/dashboard');
  return result;
}

export async function retireAnnouncement(formData: FormData) {
  const result = await runAdminCommand('retireAnnouncement', 'system', formData);
  if (!result.success) return result;
  revalidatePath('/system');
  revalidatePath('/dashboard');
  return result;
}

export async function addBlockedWord(formData: FormData) {
  const result = await runAdminCommand('addBlockedWord', 'system', formData);
  if (!result.success) return result;
  revalidatePath('/system');
  revalidatePath('/dashboard');
  return result;
}

export async function removeBlockedWord(formData: FormData) {
  const result = await runAdminCommand('removeBlockedWord', 'system', formData);
  if (!result.success) return result;
  revalidatePath('/system');
  revalidatePath('/dashboard');
  return result;
}

export async function approveBusinessApplication(formData: FormData) {
  const result = await provisionAccount('business', formData);
  if (!result.success) return result;
  revalidatePath('/businesses');
  return result;
}

export async function rejectBusinessApplication(formData: FormData) {
  const result = await runAdminCommand('rejectBusinessApplication', 'business_manage', formData);
  if (!result.success) return result;
  revalidatePath('/businesses');
  revalidatePath('/dashboard');
  return result;
}

export async function sendTicketReply(formData: FormData) {
  const result = await runAdminCommand('sendTicketReply', 'support', formData);
  if (!result.success) return result;
  revalidatePath('/support');
  revalidatePath('/dashboard');
  const tid = String(formData.get('tid') || formData.get('rid') || '');
  if (tid) revalidatePath('/support/' + tid);
  return result;
}

export async function setTicketStatus(formData: FormData) {
  const result = await runAdminCommand('setTicketStatus', 'support', formData);
  if (!result.success) return result;
  revalidatePath('/support');
  revalidatePath('/dashboard');
  const tid = String(formData.get('tid') || formData.get('rid') || '');
  if (tid) revalidatePath('/support/' + tid);
  return result;
}

export async function archiveOrganization(formData: FormData) {
  const result = await runAdminCommand('archiveOrganization', 'organization_manage', formData);
  if (!result.success) return result;
  revalidatePath('/organizations');
  revalidatePath('/dashboard');
  return result;
}

export async function restoreOrganization(formData: FormData) {
  const result = await runAdminCommand('restoreOrganization', 'organization_manage', formData);
  if (!result.success) return result;
  revalidatePath('/organizations');
  revalidatePath('/dashboard');
  return result;
}

export async function adminTransferOwnership(formData: FormData) {
  const result = await runAdminCommand('adminTransferOwnership', 'organization_manage', formData);
  if (!result.success) return result;
  revalidatePath('/organizations');
  revalidatePath('/dashboard');
  return result;
}

export async function adminDeleteAccount(formData: FormData) {
  const result = await runAdminCommand('adminDeleteAccount', 'account_delete', formData);
  if (!result.success) return result;
  revalidatePath('/users');
  revalidatePath('/dashboard');
  return result;
}

export async function adminRemoveComment(formData: FormData) {
  const result = await runAdminCommand('adminRemoveComment', 'comment_delete', formData);
  if (!result.success) return result;
  revalidatePath('/content');
  revalidatePath('/dashboard');
  return result;
}

