'use server';
/**
 * Server actions authenticate the active native session and check the action's
 * role policy. Database commands save their mutation, audit and retry receipt together.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { anonClient, serviceClient } from '@/lib/supabaseAdmin';
import { adminFromToken, requirePermission } from '@/lib/adminAuth';
import { provisionAccount } from '@/lib/adminProvision';
import { saveAdminSession } from '@/lib/adminSession';


import { runAdminCommand } from '@/lib/adminCommand';
export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) redirect('/?error=' + encodeURIComponent('Sign in failed'));
  const admin = await adminFromToken(data.session.access_token);
  if (!admin) redirect('/?error=' + encodeURIComponent('An active staff session is required. Contact your administrator if access is unavailable.'));
  await saveAdminSession(data.session);
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
  await runAdminCommand('approveApplication', 'verification', formData);
  revalidatePath('/queue');
  revalidatePath('/dashboard');
}

export async function rejectApplication(formData: FormData) {
  await runAdminCommand('rejectApplication', 'verification', formData);
  revalidatePath('/queue');
  revalidatePath('/dashboard');
}

export async function suspendUser(formData: FormData) {
  await runAdminCommand('suspendUser', 'user_moderate', formData);
  revalidatePath('/users');
  revalidatePath('/dashboard');
}

export async function restoreUser(formData: FormData) {
  await runAdminCommand('restoreUser', 'user_moderate', formData);
  revalidatePath('/users');
  revalidatePath('/dashboard');
}

export async function revokeVerification(formData: FormData) {
  await runAdminCommand('revokeVerification', 'verification', formData);
  revalidatePath('/users');
  revalidatePath('/dashboard');
}

export async function dismissReport(formData: FormData) {
  await runAdminCommand('dismissReport', 'report_post', formData);
  revalidatePath('/reports');
  revalidatePath('/dashboard');
}

export async function removeReportedPost(formData: FormData) {
  await runAdminCommand('removeReportedPost', 'report_post', formData);
  revalidatePath('/reports');
  revalidatePath('/dashboard');
}

export async function removeReportedListing(formData: FormData) {
  await runAdminCommand('removeReportedListing', 'report_listing', formData);
  revalidatePath('/reports');
  revalidatePath('/dashboard');
}

export async function resolveUserReport(formData: FormData) {
  await runAdminCommand('resolveUserReport', 'report_user', formData);
  revalidatePath('/reports');
  revalidatePath('/dashboard');
}

export async function adminRemovePost(formData: FormData) {
  await runAdminCommand('adminRemovePost', 'post_moderate', formData);
  revalidatePath('/content');
  revalidatePath('/dashboard');
}

export async function adminRemoveListing(formData: FormData) {
  await runAdminCommand('adminRemoveListing', 'market_moderate', formData);
  revalidatePath('/market');
  revalidatePath('/dashboard');
}

export async function resolveTicket(formData: FormData) {
  await runAdminCommand('resolveTicket', 'support', formData);
  revalidatePath('/support');
  revalidatePath('/dashboard');
  const tid = String(formData.get('tid') || formData.get('rid') || '');
  if (tid) revalidatePath('/support/' + tid);
}

export async function approveCampaign(formData: FormData) {
  await runAdminCommand('approveCampaign', 'ads', formData);
  revalidatePath('/ads');
  revalidatePath('/dashboard');
}

export async function rejectCampaign(formData: FormData) {
  await runAdminCommand('rejectCampaign', 'ads', formData);
  revalidatePath('/ads');
  revalidatePath('/dashboard');
}

export async function adminEndCampaign(formData: FormData) {
  await runAdminCommand('adminEndCampaign', 'ads', formData);
  revalidatePath('/ads');
  revalidatePath('/dashboard');
}

export async function inviteStaff(formData: FormData) {
  await provisionAccount('staff', formData);
  revalidatePath('/staff');
}

export async function setStaffRole(formData: FormData) {
  await runAdminCommand('setStaffRole', 'staff_manage', formData);
  revalidatePath('/staff');
  revalidatePath('/dashboard');
}

export async function deactivateStaff(formData: FormData) {
  await runAdminCommand('deactivateStaff', 'staff_manage', formData);
  revalidatePath('/staff');
  revalidatePath('/dashboard');
}

export async function issueStrike(formData: FormData) {
  await runAdminCommand('issueStrike', 'user_moderate', formData);
  revalidatePath('/users');
  revalidatePath('/dashboard');
}

export async function liftRestriction(formData: FormData) {
  await runAdminCommand('liftRestriction', 'user_moderate', formData);
  revalidatePath('/users');
  revalidatePath('/dashboard');
}

export async function adminRemoveStory(formData: FormData) {
  await runAdminCommand('adminRemoveStory', 'post_moderate', formData);
  revalidatePath('/stories');
  revalidatePath('/dashboard');
}

export async function toggleFlag(formData: FormData) {
  await runAdminCommand('toggleFlag', 'system', formData);
  revalidatePath('/system');
  revalidatePath('/dashboard');
}

export async function publishAnnouncement(formData: FormData) {
  await runAdminCommand('publishAnnouncement', 'system', formData);
  revalidatePath('/system');
  revalidatePath('/dashboard');
}

export async function retireAnnouncement(formData: FormData) {
  await runAdminCommand('retireAnnouncement', 'system', formData);
  revalidatePath('/system');
  revalidatePath('/dashboard');
}

export async function addBlockedWord(formData: FormData) {
  await runAdminCommand('addBlockedWord', 'system', formData);
  revalidatePath('/system');
  revalidatePath('/dashboard');
}

export async function removeBlockedWord(formData: FormData) {
  await runAdminCommand('removeBlockedWord', 'system', formData);
  revalidatePath('/system');
  revalidatePath('/dashboard');
}

export async function approveBusinessApplication(formData: FormData) {
  await provisionAccount('business', formData);
  revalidatePath('/businesses');
}

export async function rejectBusinessApplication(formData: FormData) {
  await runAdminCommand('rejectBusinessApplication', 'business_manage', formData);
  revalidatePath('/businesses');
  revalidatePath('/dashboard');
}

export async function sendTicketReply(formData: FormData) {
  await runAdminCommand('sendTicketReply', 'support', formData);
  revalidatePath('/support');
  revalidatePath('/dashboard');
  const tid = String(formData.get('tid') || formData.get('rid') || '');
  if (tid) revalidatePath('/support/' + tid);
}

export async function setTicketStatus(formData: FormData) {
  await runAdminCommand('setTicketStatus', 'support', formData);
  revalidatePath('/support');
  revalidatePath('/dashboard');
  const tid = String(formData.get('tid') || formData.get('rid') || '');
  if (tid) revalidatePath('/support/' + tid);
}

export async function archiveOrganization(formData: FormData) {
  await runAdminCommand('archiveOrganization', 'organization_manage', formData);
  revalidatePath('/organizations');
  revalidatePath('/dashboard');
}

export async function restoreOrganization(formData: FormData) {
  await runAdminCommand('restoreOrganization', 'organization_manage', formData);
  revalidatePath('/organizations');
  revalidatePath('/dashboard');
}

export async function adminTransferOwnership(formData: FormData) {
  await runAdminCommand('adminTransferOwnership', 'organization_manage', formData);
  revalidatePath('/organizations');
  revalidatePath('/dashboard');
}

export async function adminDeleteAccount(formData: FormData) {
  await runAdminCommand('adminDeleteAccount', 'account_delete', formData);
  revalidatePath('/users');
  revalidatePath('/dashboard');
}

export async function adminRemoveComment(formData: FormData) {
  await runAdminCommand('adminRemoveComment', 'comment_delete', formData);
  revalidatePath('/content');
  revalidatePath('/dashboard');
}

