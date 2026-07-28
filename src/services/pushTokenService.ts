import { Platform } from 'react-native';
import { supabase } from './supabase';

export const pushTokenService = {
  async saveToken(userId: string, expoPushToken: string, deviceName?: string) {
    // Use RPC to handle cross-user cleanup + upsert in one call
    // The RPC is SECURITY DEFINER so it can delete tokens from other users
    const { error } = await supabase.rpc('save_push_token', {
      p_user_id: userId,
      p_token: expoPushToken,
      p_device_name: deviceName ?? null,
      p_platform: Platform.OS,
    });

    if (error) {
      console.log('SAVE_PUSH_TOKEN_ERROR', error);
      throw error;
    }
  },

  /** Attach the iOS PushKit VoIP token to this device's existing row. */
  async saveVoipToken(expoPushToken: string, voipToken: string) {
    const { error } = await supabase.rpc('save_voip_token', {
      p_expo_token: expoPushToken,
      p_voip_token: voipToken,
    });
    if (error) console.log('SAVE_VOIP_TOKEN_ERROR', error);
  },

  async removeToken(userId: string, expoPushToken: string) {
    const { error } = await supabase
      .from('user_push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('expo_push_token', expoPushToken);

    if (error) {
      console.log('REMOVE_PUSH_TOKEN_ERROR', error);
      throw error;
    }
  },
};