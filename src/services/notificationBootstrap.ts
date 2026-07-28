import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { AppState } from 'react-native';
import { pushTokenService } from './pushTokenService';
import { nativeCallService } from './nativeCallService';

// Last token this device registered, so logout can remove exactly it.
export let lastPushToken: string | null = null;
let rotationSub: { remove: () => void } | null = null;
let rotationUserId: string | null = null;

// Show notifications even when app is foregrounded — EXCEPT call pushes:
// in the foreground the floating answer banner owns incoming calls, and an
// OS banner stacked on top of it is a visual double.
const CALL_PUSH_TYPES = new Set(['incoming_call', 'call', 'group_call', 'missed_call']);
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const d: any = notification?.request?.content?.data || {};
    const suppress = AppState.currentState === 'active' && CALL_PUSH_TYPES.has(String(d.type || ''));
    return {
      shouldShowBanner: !suppress,
      shouldShowList: true,
      shouldPlaySound: !suppress,
      shouldSetBadge: true,
    };
  },
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
    lastPushToken = token;
  } catch (error) {
    console.log('TOKEN_SAVE_ERROR', error);
  }

  // Dormant until the CallKit build: registers the iOS VoIP token and files
  // it beside the Expo token so the APNs sender can ring locked phones.
  nativeCallService.registerVoipToken((voip) => {
    if (lastPushToken) pushTokenService.saveVoipToken(lastPushToken, voip).catch(() => {});
  });

  // Re-save on token rotation, or pushes silently die until the next login.
  rotationUserId = userId;
  if (!rotationSub) {
    rotationSub = Notifications.addPushTokenListener((t) => {
      const rotated = (t as any)?.data;
      if (!rotated || !rotationUserId || rotated === lastPushToken) return;
      pushTokenService.saveToken(rotationUserId, rotated, Device.deviceName ?? undefined)
        .then(() => { lastPushToken = rotated; })
        .catch((e) => console.log('TOKEN_ROTATE_SAVE_ERROR', e));
    });
  }

  return token;
}