import * as Linking from 'expo-linking';
import type { LinkingOptions } from '@react-navigation/native';

/**
 * Deep linking config. Handles:
 *   - PlatinumCircles-nest://auth/callback  (email verification redirect from Supabase)
 *   - exp://...--/auth/callback     (same, for Expo Go development)
 *   - PlatinumCircles-nest://post/:postId    (future: push-notification deep links)
 *   - PlatinumCircles-nest://user/:userId    (future: shareable profile links)
 *
 * When adding a new deep-linkable route, add it under the relevant screen
 * in the `screens` config below. Names must match the screen names
 * registered in AppNavigator exactly.
 */
export const linking: LinkingOptions<any> = {
  prefixes: [Linking.createURL('/'), 'PlatinumCircles-nest://'],
  config: {
    screens: {
      // Unauthenticated
      Login: 'login',
      SignUp: 'signup',
      VerifyEmail: 'verify-email',
      AuthCallback: 'auth/callback',
      SetupProfile: 'setup-profile',

      // Authenticated root
      Main: {
        screens: {
          Feed: {
            screens: {
              FeedMain: 'feed',
              Post: 'post/:postId',
              UserProfile: 'user/:userId',
            },
          },
          Messages: {
            screens: {
              Conversations: 'messages',
              Chat: 'chat/:userId',
            },
          },
        },
      },
    },
  },
};