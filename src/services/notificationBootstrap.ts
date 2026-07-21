import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { pushTokenService } from './pushTokenService';

// Show notifications even when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// ── Shared call navigation guard ──────────────────────────────────────────
// Single source of truth. Used by both:
//   - AppNavigator (push tap handler)
//   - IncomingCallListener (realtime listener)
// Prevents duplicate navigation to IncomingCallScreen.

let activeCallNavId: string | null = null;
let activeCallNavTimer: ReturnType<typeof setTimeout> | null = null;

export function setActiveCallNavId(callId: string) {
  activeCallNavId = callId;
  if (activeCallNavTimer) clearTimeout(activeCallNavTimer);
  // Auto-clear after 60s as safety net
  activeCallNavTimer = setTimeout(() => {
    activeCallNavId = null;
    activeCallNavTimer = null;
  }, 60000);
}

export function clearCallNavGuard() {
  activeCallNavId = null;
  if (activeCallNavTimer) {
    clearTimeout(activeCallNavTimer);
    activeCallNavTimer = null;
  }
}

export function isCallNavActive(callId?: string): boolean {
  if (!callId) return activeCallNavId !== null;
  return activeCallNavId === callId;
}

export function getActiveCallNavId(): string | null {
  return activeCallNavId;
}

// ── Push token registration ───────────────────────────────────────────────

export async function registerForPushNotifications(userId: string) {
  if (!Device.isDevice) {
    console.log('Must use physical device for push notifications');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Permission not granted for notifications');
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  const tokenResponse = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  const token = tokenResponse.data;

  try {
    await pushTokenService.saveToken(
      userId,
      token,
      Device.deviceName ?? undefined,
    );
  } catch (error) {
    console.log('TOKEN_SAVE_ERROR', error);
  }

  return token;
}