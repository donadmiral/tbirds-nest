import { Platform } from 'react-native';
import { supabase } from './supabase';

export const pushTokenService = {
  async saveToken(userId: string, expoPushToken: string, deviceName?: string) {
    const { error } = await supabase
      .from('user_push_tokens')
      .upsert(
        {
          user_id: userId,
          expo_push_token: expoPushToken,
          device_name: deviceName ?? null,
          platform: Platform.OS,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,expo_push_token',
        }
      );

    if (error) {
      console.log('SAVE_PUSH_TOKEN_ERROR', error);
      throw error;
    }
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