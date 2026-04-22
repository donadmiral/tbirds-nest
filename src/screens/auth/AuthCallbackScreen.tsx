import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import * as Linking from 'expo-linking';
import { supabase } from '../../services/supabase';

export default function AuthCallbackScreen({ navigation }: any) {
  useEffect(() => {
    async function handleAuth() {
      const url = await Linking.getInitialURL();

      console.log('AUTH_CALLBACK_URL', url);

      if (url) {
        // Let Supabase handle session automatically
        const { data: sessionData } = await supabase.auth.getSession();

        console.log('AUTH_CALLBACK_SESSION', {
          hasSession: !!sessionData?.session,
        });

        if (sessionData?.session) {
          navigation.replace('Main');
        }
      }
    }

    handleAuth();
  }, [navigation]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}