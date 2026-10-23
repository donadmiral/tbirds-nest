'use server';
import { cookies, headers } from 'next/headers';
import { recoveryPkceClient, recoverySessionClient, saveElevatedRecovery, clearRecovery } from '@/lib/adminRecovery';
import { trustedAuthOrigin } from '@/lib/adminRecoveryPolicy';
import { serviceClient } from '@/lib/supabaseAdmin';

const expired = 'This recovery session has expired or could not be verified. Request a new link and open it in the same browser.';
const fail = (error: string) => ({ success: false as const, error });
const sent = { success: true as const, message: 'If an account uses that email in this environment, a reset link will arrive shortly. Open it in this same browser. Check your spam folder; requesting another link replaces the previous one.' };

async function trustedRequest() {
  return trustedAuthOrigin((await headers()).get('origin'), process.env);
}

export async function requestPasswordReset(form: FormData) {
  const origin = await trustedRequest();
  if (!origin) return fail('Password recovery is not configured for this admin address. Contact your administrator.');
  const email = String(form.get('email') || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email address.');
  try {
    const client = await recoveryPkceClient();
    await client.auth.resetPasswordForEmail(email, { redirectTo: origin + '/reset-password/callback' });
    // Even SMTP delivery errors can reveal that an address exists. A provider response
    // never confirms account existence or delivery; administrators inspect delivery logs.
    return sent;
  } catch { return fail('Recovery email is temporarily unavailable. Please try again shortly.'); }
}

export async function verifyRecoveryAuthenticator(form: FormData) {
  if (!await trustedRequest()) return fail('Open the recovery page again before continuing.');
  const factorId = String(form.get('factorId') || '');
  const code = String(form.get('code') || '');
  if (!/^[0-9]{6}$/.test(code)) return fail('Enter the current six-digit authenticator code.');
  try {
    const { client, grant } = await recoverySessionClient();
    const factors = await client.auth.mfa.listFactors();
    if (factors.error || !factors.data.totp.some(factor => factor.id === factorId && factor.status === 'verified')) return fail('Select an existing authenticator for this account.');
    const result = await client.auth.mfa.challengeAndVerify({ factorId, code });
    if (result.error) return fail('The code was not accepted. Try the current code from your authenticator.');
    const { data } = await client.auth.getSession();
    if (!data.session) return fail(expired);
    await saveElevatedRecovery(data.session, grant);
    return { success: true as const };
  } catch { return fail(expired); }
}

export async function updateRecoveryPassword(form: FormData) {
  if (!await trustedRequest()) return fail('Open the recovery page again before continuing.');
  const password = String(form.get('password') || '');
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) return fail('Use at least 12 characters and no more than 72 UTF-8 bytes.');
  if (password !== String(form.get('confirmation') || '')) return fail('The passwords do not match.');
  try {
    const { client, admin, grant } = await recoverySessionClient();
    const factors = await client.auth.mfa.listFactors();
    if (factors.error) return fail('Your account security could not be checked. Try again.');
    if (factors.data.all.some(factor => factor.status === 'verified') && admin.aal !== 'aal2') return fail('Verify your existing authenticator before changing the password.');
    const result = await client.auth.updateUser({ password });
    if (result.error) {
      if (result.error.code === 'same_password') return fail('Choose a different password from the current one.');
      if (result.error.code === 'weak_password') return fail('Choose a stronger password. A long, unique passphrase is recommended.');
      return fail('The password could not be updated. Check your connection or request a new recovery link.');
    }
    if (result.data.user?.id !== grant.userId) return fail('The password update could not be confirmed.');
    // Updating a password must not create a normal admin login or remove MFA.
    let sessionsRevoked = false;
    try { sessionsRevoked = !(await serviceClient().auth.admin.signOut(grant.accessToken, 'global')).error; } catch { /* Report the partial outcome truthfully. */ }
    await clearRecovery();
    const jar = await cookies();
    jar.delete('pc_admin_token'); jar.delete('pc_admin_refresh');
    return { success: true as const, message: sessionsRevoked
      ? 'Password updated. Sign in with your new password and complete authenticator verification.'
      : 'Password updated. Existing-session sign-out could not be confirmed. Sign in with the new password and ask your administrator to review active sessions.' };
  } catch { return fail(expired); }
}
