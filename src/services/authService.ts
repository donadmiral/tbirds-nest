import { supabase } from './supabase';
import { pickFromLibrary, uploadMedia } from './mediaService';
import { isAsuEmail } from '../utils/isAsuEmail';

export type SignUpResult = { needsEmailVerification: boolean };

export const authService = {
  /**
   * Create a new account. If the email is already registered but unverified,
   * re-send the verification email instead of surfacing an error.
   *
   * STEP 3: Account classification is handled by the database trigger
   * on profiles insert (or by the backfill). But we also pass account_type
   * in user_metadata so SetupProfileScreen can read it immediately.
   */
  async signUp(
    email: string,
    password: string,
    fullName: string,
    redirectTo?: string
  ): Promise<SignUpResult> {
    const isASU = isAsuEmail(email);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: {
          full_name: fullName,
          account_type: isASU ? 'asu' : 'public',
        },
      },
    });

    if (error && /already/i.test(error.message)) {
      await this.resendVerification(email, redirectTo);
      return { needsEmailVerification: true };
    }
    if (error) throw error;

    // Safety net: if DB trigger hasn't fired yet or account_type is NULL,
    // stamp classification. Only writes if account_type is still NULL.
    // This is idempotent and never overrides the trigger's work.
    if (data?.user?.id) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          account_type: isASU ? 'asu' : 'public',
          institution: isASU ? 'ASU' : null,
          is_verified_institution: false,
          school: isASU ? 'Arizona State University' : null,
        })
        .eq('id', data.user.id)
        .is('account_type', null);

      if (updateError) {
        console.log('[authService.signUp] profile classification error:', updateError.message);
        // Non-fatal: the database trigger handles this
      }
    }

    return { needsEmailVerification: !data.session };
  },

  async signIn(email: string, password: string) {
    // Sign in with a username too: the definer function resolves a
    // handle to its address even before any session exists.
    if (!email.includes('@')) {
      const { data: resolved } = await supabase.rpc('email_for_username', { p_username: email });
      if (resolved) email = resolved as string;
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  /**
   * Re-send the signup verification email. Safe to call repeatedly.
   */
  async resendVerification(email: string, redirectTo?: string) {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  },

  /**
   * Send a password-reset email with OTP code.
   */
  async resetPassword(email: string, redirectTo?: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) throw error;
  },

  /**
   * Verify OTP code for password reset.
   */
  async verifyResetCode(email: string, code: string) {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (error) throw error;
  },

  /**
   * Update the password of the currently signed-in user.
   */
  async updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  async updateProfile(userId: string, updates: Record<string, any>) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Upload an avatar image from a local URI.
   */
  async uploadAvatar(userId: string, uri: string): Promise<string> {
    const ext = (uri.split('.').pop()?.toLowerCase() || 'jpg').replace('jpeg', 'jpg');
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const { url } = await uploadMedia(
      'avatars',
      userId,
      { uri, kind: 'image', ext, mimeType, base64: null },
      { filename: `avatar_${Date.now()}.${ext}` }
    );
    return url;
  },

  /**
   * Convenience: open the library picker and upload the selected avatar.
   */
  async pickAndUploadAvatar(userId: string): Promise<string | null> {
    const picked = await pickFromLibrary({
      allowVideos: false,
      multiple: false,
      quality: 0.8,
    });
    if (!picked.length) return null;
    const { url } = await uploadMedia('avatars', userId, picked[0], {
      filename: `avatar_${Date.now()}.${picked[0].ext}`,
    });
    return url;
  },

  async setPresence(userId: string, isOnline: boolean) {
    const { error } = await supabase.from('user_presence').upsert({
      user_id: userId,
      is_online: isOnline,
      last_seen: new Date().toISOString(),
    });
    if (error) console.log('[setPresence]', error.message);
  },
};