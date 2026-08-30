import Constants from 'expo-constants';
/**
 * nativeCallService - the dormant CallKit / ConnectionService layer.
 *
 * Phase B of the calls standard: the OS owns lock-screen calling. This file
 * is written BEFORE the native build exists. Every native module is loaded
 * lazily and every method no-ops when the module is absent, so the current
 * dev client runs exactly as before. The next dev build (react-native-callkeep
 * + react-native-voip-push-notification compiled in) brings it to life with
 * zero further JS changes.
 *
 * BUILD-DAY CHECKLIST (do these when running the dev build):
 *  1. npx expo prebuild --clean   (or EAS build; callkeep autolinks)
 *  2. iOS: Apple Developer -> Keys -> create an APNs Auth Key (p8); note
 *     Key ID + Team ID. Set APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID as
 *     Supabase function secrets for the VoIP push sender.
 *  3. iOS: Xcode capabilities: Push Notifications + Background Modes
 *     (voip, audio) - app.json already declares them.
 *  4. Android: permissions below are already in app.json.
 *  5. Flip NATIVE_CALLS_ENABLED to true and rebuild.
 */
import { Platform } from 'react-native';

// Master switch: stays false until the first build that compiles the natives.
export // The switch is BINARY-AWARE: native calls arm only on builds that
// actually compiled the PushKit delegate (build 5 onward). Older
// binaries and Expo Go read a lower or unparseable native build
// number and stay safely dormant, so Metro can never crash them.
const __nb = Number((Constants as any)?.nativeBuildVersion ?? 0) || 0;
const NATIVE_CALLS_ENABLED = __nb >= 5;

let RNCallKeep: any = null;
let VoipPushNotification: any = null;

function loadNatives(): boolean {
  if (!NATIVE_CALLS_ENABLED) return false;
  if (RNCallKeep) return true;
  try {
    RNCallKeep = require('react-native-callkeep').default;
    if (Platform.OS === 'ios') {
      VoipPushNotification = require('react-native-voip-push-notification').default;
    }
    return true;
  } catch (e) {
    console.log('[NativeCalls] natives unavailable in this binary:', (e as any)?.message);
    RNCallKeep = null;
    return false;
  }
}

export type NativeCallEvents = {
  onAnswer: (callUuid: string) => void;
  onEnd: (callUuid: string) => void;
  onAudioSessionActivated?: () => void;
};

export const nativeCallService = {
  available(): boolean {
    return loadNatives();
  },

  /** Call once at app start (after auth). Safe to call today: no-ops. */
  async setup(events: NativeCallEvents): Promise<boolean> {
    if (!loadNatives()) return false;
    try {
      await RNCallKeep.setup({
        ios: {
          appName: 'Platinum Circles',
          supportsVideo: true,
          maximumCallGroups: '1',
          maximumCallsPerCallGroup: '1',
        },
        android: {
          alertTitle: 'Calls permission',
          alertDescription: 'Platinum Circles needs to manage calls so you can answer from the lock screen.',
          cancelButton: 'Cancel',
          okButton: 'Allow',
          additionalPermissions: [],
          foregroundService: {
            channelId: 'app.platinumcircles.calls',
            channelName: 'Ongoing calls',
            notificationTitle: 'Call in progress',
          },
        },
      });
      RNCallKeep.addEventListener('answerCall', ({ callUUID }: any) => events.onAnswer(String(callUUID).toLowerCase()));
      RNCallKeep.addEventListener('endCall', ({ callUUID }: any) => events.onEnd(String(callUUID).toLowerCase()));
      if (Platform.OS === 'ios' && events.onAudioSessionActivated) {
        RNCallKeep.addEventListener('didActivateAudioSession', events.onAudioSessionActivated);
      }
      return true;
    } catch (e) {
      console.log('[NativeCalls] setup failed:', (e as any)?.message);
      return false;
    }
  },

  /** iOS: register for VoIP pushes; resolves the PushKit token via callback. */
  registerVoipToken(onToken: (token: string) => void): void {
    if (!loadNatives() || Platform.OS !== 'ios' || !VoipPushNotification) return;
    try {
      VoipPushNotification.addEventListener('register', (token: string) => onToken(token));
      VoipPushNotification.registerVoipToken();
    } catch (e) {
      console.log('[NativeCalls] voip register failed:', (e as any)?.message);
    }
  },

  /**
   * iOS: listen for arriving VoIP pushes and report each one to CallKit.
   *
   * This is not optional. Since iOS 13 every PushKit push MUST result in an
   * incoming call reported to CallKit, in the same run loop. Miss one and iOS
   * terminates the app; miss several and Apple stops delivering VoIP pushes to
   * the app altogether. So the report happens first, before any network call
   * or state update, and the app catches up afterwards.
   *
   * didLoadWithEvents is what makes a killed app ring: pushes that arrived
   * before the JavaScript engine existed are replayed here on boot.
   */
  listenForVoipPushes(onReported?: (callId: string) => void): void {
    if (!loadNatives() || Platform.OS !== 'ios' || !VoipPushNotification) return;
    const report = (payload: any) => {
      const callId = String(payload?.callId ?? payload?.callid ?? '').toLowerCase();
      if (!callId) return;
      this.displayIncomingCall(
        callId,
        String(payload?.callerName || 'Platinum Circles'),
        !!payload?.isVideo,
      );
      try { onReported?.(callId); } catch {}
    };
    try {
      VoipPushNotification.addEventListener('notification', (payload: any) => report(payload));
      VoipPushNotification.addEventListener('didLoadWithEvents', (events: any[]) => {
        (events || []).forEach((e: any) => {
          if (e?.name === VoipPushNotification.RNVoipPushRemoteNotificationReceivedEvent) report(e?.data);
        });
      });
    } catch (e) {
      console.log('[NativeCalls] voip push listen failed:', (e as any)?.message);
    }
  },

  /** Show the OS incoming-call screen (rings natively, works locked). */
  displayIncomingCall(callUuid: string, callerName: string, hasVideo: boolean): void {
    if (!loadNatives()) return;
    try {
      RNCallKeep.displayIncomingCall(callUuid, callerName, callerName, 'generic', hasVideo);
    } catch (e) {
      console.log('[NativeCalls] displayIncomingCall failed:', (e as any)?.message);
    }
  },

  /** Tell the OS the call connected (starts the green bar / system timer). */
  reportConnected(callUuid: string): void {
    if (!loadNatives()) return;
    try { RNCallKeep.setCurrentCallActive(callUuid); } catch {}
  },

  /** Tell the OS an outgoing call started (so the system knows we are busy). */
  startOutgoingCall(callUuid: string, calleeName: string, hasVideo: boolean): void {
    if (!loadNatives()) return;
    try { RNCallKeep.startCall(callUuid, calleeName, calleeName, 'generic', hasVideo); } catch {}
  },

  /** End the OS-side call representation. Idempotent. */
  endNativeCall(callUuid: string): void {
    if (!loadNatives()) return;
    try { RNCallKeep.endCall(callUuid); } catch {}
  },

  endAllNativeCalls(): void {
    if (!loadNatives()) return;
    try { RNCallKeep.endAllCalls(); } catch {}
  },
};