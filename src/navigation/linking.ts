import * as Linking from 'expo-linking';
import { getStateFromPath, type LinkingOptions } from '@react-navigation/native';

// Navigation 6's tolerant query decoder can perform unbounded work on malformed
// percent escapes. Validate once with the native linear decoder before delegation.
// Keep the original encoded path: decoding it here would change route boundaries.
export const MAX_DEEP_LINK_PATH_LENGTH = 16 * 1024;
export const getSafeStateFromPath: typeof getStateFromPath = (path, options) => {
  if (typeof path !== 'string' || path.length > MAX_DEEP_LINK_PATH_LENGTH) return undefined;
  try {
    decodeURIComponent(path);
  } catch {
    return undefined;
  }
  return getStateFromPath(path, options);
};

/**
 * Deep linking config. Handles:
 *   - platinum-circles://auth/callback  (email verification redirect from Supabase)
 *   - exp://...--/auth/callback         (same, for Expo Go development)
 *   - platinum-circles://post/:postId   (future: push-notification deep links)
 *   - platinum-circles://user/:userId   (future: shareable profile links)
 *
 * When adding a new deep-linkable route, add it under the relevant screen
 * in the `screens` config below. Names must match the screen names
 * registered in AppNavigator exactly.
 */
export const linking: LinkingOptions<any> = {
  // Resolve the installed app's scheme so QA links cannot open production.
  prefixes: [Linking.createURL('/')],
  getStateFromPath: getSafeStateFromPath,
  config: {
    screens: {
      // Unauthenticated
      Login: 'login',
      SignUp: 'signup',
      VerifyEmail: 'verify-email',
      AuthCallback: 'auth/callback',
      SetupProfile: 'setup-profile',
      // Authenticated root
      StoryViewer: 'story/:storyId',
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
