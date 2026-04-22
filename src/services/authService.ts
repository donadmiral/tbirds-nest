import { supabase } from './supabase';
import { pickFromLibrary, uploadMedia } from './mediaService';

export type SignUpResult = { needsEmailVerification: boolean };

export const authService = {
  /**
   * Create a new account. If the email is already registered but unverified,
   * re-send the verification email instead of surfacing an error.
   */
  async signUp(
    email: string,
    password: string,
    fullName: string,
    redirectTo?: string
  ): Promise<SignUpResult> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: { full_name: fullName },
      },
    });

    if (error && /already/i.test(error.message)) {
      await this.resendVerification(email, redirectTo);
      return { needsEmailVerification: true };
    }
    if (error) throw error;

    return { needsEmailVerification: !data.session };
  },

  async signIn(email: string, password: string) {
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
   * Send a password-reset email.
   */
  async resetPassword(email: string, redirectTo?: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
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
   * Upload an avatar image from a local URI. Backward-compatible with the
   * previous signature. Every screen that saves avatars should use this.
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
   * Convenience: open the library picker and upload the selected avatar
   * in one call. Returns the public URL or null if the user cancelled.
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