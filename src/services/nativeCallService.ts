import Constants from 'expo-constants';
/** Optional CallKit / ConnectionService integration, loaded only in compatible native binaries. */
import { notificationUuid } from '../../shared/notificationTap';
import { Platform } from 'react-native';

// Master switch: stays false until the first build that compiles the natives.
export // The switch is BINARY-AWARE: native calls arm only on builds that
// actually compiled the PushKit delegate (build 5 onward). Older
// binaries and Expo Go read a lower or unparseable native build
// number and stay safely dormant, so Metro can never crash them.
const __nb = Number((Constants as any)?.nativeBuildVersion ?? 0) || 0;
// Expo Go is the one binary without the PushKit delegate; every EAS build
// since August carries it, whatever number the build reports.
const __isExpoGo = (Constants as any)?.appOwnership === 'expo' || (Constants as any)?.executionEnvironment === 'storeClient';
const NATIVE_CALLS_ENABLED = !__isExpoGo && (__nb >= 5 || !(__nb > 0));
console.log('[NativeCalls] gate', JSON.stringify({ build: __nb, expoGo: __isExpoGo, enabled: NATIVE_CALLS_ENABLED }));

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
  onAnswer: (callUuid: string) => void | Promise<void>;
  onEnd: (callUuid: string) => void | Promise<void>;
  onAudioSessionActivated?: () => void;
};

let setupPromise: Promise<boolean> | null = null;
let setupReady = false;
let activeEvents: { events: NativeCallEvents } | null = null;
let voipListenersReady = false;
let tokenHandler: ((token: string) => void) | null = null;
let reportHandler: { callback: (callId: string, recipientId?: string) => void } | null = null;
let cachedToken: string | null = null;
const pendingReports: { callId: string; recipientId?: string; receivedAt: number }[] = [];
type NativeAction = { kind: 'answer' | 'end'; callId: string; receivedAt: number };
const pendingActions = new Map<string, NativeAction>();
const seenActions = new Map<string, number>();

function flushNativeActions() {
  const owner = activeEvents;
  if (!owner) return;
  for (const [id, action] of pendingActions) {
    if (activeEvents !== owner) return;
    pendingActions.delete(id);
    if (Date.now() - action.receivedAt > 45_000) continue;
    try {
      const result = action.kind === 'answer' ? owner.events.onAnswer(id) : owner.events.onEnd(id);
      void Promise.resolve(result).catch(() => {});
    } catch {}
  }
}

function dispatchNativeAction(kind: NativeAction['kind'], value: unknown) {
  if (!notificationUuid(value)) return;
  const callId = value.toLowerCase(), now = Date.now();
  for (const [key, at] of seenActions) if (now - at > 45_000) seenActions.delete(key);
  const key = `${kind}:${callId}`;
  if (seenActions.has(key) || (kind === 'answer' && seenActions.has(`end:${callId}`))) return;
  seenActions.set(key, now);
  while (seenActions.size > 128) seenActions.delete(seenActions.keys().next().value!);
  // A hangup received before Auth/navigation is ready supersedes its queued answer.
  pendingActions.set(callId, { kind, callId, receivedAt: now });
  while (pendingActions.size > 32) pendingActions.delete(pendingActions.keys().next().value!);
  flushNativeActions();
}

function replayNativeActions(value: unknown) {
  if (!Array.isArray(value)) return;
  const finalActions = new Map<string, NativeAction['kind']>();
  for (const event of value.slice(-128)) {
    const id = event?.data?.callUUID;
    if (!notificationUuid(id)) continue;
    if (event.name === 'RNCallKeepPerformEndCallAction') finalActions.set(id.toLowerCase(), 'end');
    else if (event.name === 'RNCallKeepPerformAnswerCallAction' && !finalActions.has(id.toLowerCase())) finalActions.set(id.toLowerCase(), 'answer');
  }
  for (const [id, kind] of finalActions) dispatchNativeAction(kind, id);
}

function dispatchVoipToken(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 512) return;
  cachedToken = value;
  try { tokenHandler?.(value); } catch {}
}
function dispatchVoipReport(payload: any) {
  const id = payload?.uuid ?? payload?.callId ?? payload?.call_id;
  if (!notificationUuid(id)) return;
  const recipient = payload?.recipient_id;
  if (recipient !== undefined && !notificationUuid(recipient)) return;
  const report = { callId: id.toLowerCase(), ...(recipient ? { recipientId: recipient.toLowerCase() } : {}), receivedAt: Date.now() };
  if (reportHandler) { try { reportHandler.callback(report.callId, report.recipientId); } catch {} }
  else {
    pendingReports.push(report);
    while (pendingReports.length > 32) pendingReports.shift();
  }
}
function ensureVoipListeners() {
  if (voipListenersReady || !VoipPushNotification) return;
  // This library supports one listener per event; token and call replay share a dispatcher.
  VoipPushNotification.addEventListener('register', dispatchVoipToken);
  VoipPushNotification.addEventListener('notification', dispatchVoipReport);
  VoipPushNotification.addEventListener('didLoadWithEvents', (events: any[]) => {
    for (const event of Array.isArray(events) ? events.slice(-64) : []) {
      if (event?.name === VoipPushNotification.RNVoipPushRemoteNotificationsRegisteredEvent) dispatchVoipToken(event.data);
      else if (event?.name === VoipPushNotification.RNVoipPushRemoteNotificationReceivedEvent) dispatchVoipReport(event.data);
    }
  });
  voipListenersReady = true;
}

export const nativeCallService = {
  available(): boolean {
    return loadNatives();
  },

  /** Initialize once; native handlers dispatch only to the current listener owner. */
  async setup(): Promise<boolean> {
    if (!loadNatives()) return false;
    if (setupReady) return true;
    if (setupPromise) return setupPromise;
    const pending = (async () => {
      const subscriptions: { remove(): void }[] = [];
      try {
        // Subscribe before setup. Native actions can arrive while setup is still pending.
        subscriptions.push(RNCallKeep.addEventListener('answerCall', ({ callUUID }: any) => dispatchNativeAction('answer', callUUID)));
        subscriptions.push(RNCallKeep.addEventListener('endCall', ({ callUUID }: any) => dispatchNativeAction('end', callUUID)));
        if (Platform.OS === 'ios') {
          subscriptions.push(RNCallKeep.addEventListener('didLoadWithEvents', replayNativeActions));
          subscriptions.push(RNCallKeep.addEventListener('didActivateAudioSession', () => activeEvents?.events.onAudioSessionActivated?.()));
        }
        await RNCallKeep.setup({
          ios: { appName: 'Platinum Circles', supportsVideo: true, maximumCallGroups: '1', maximumCallsPerCallGroup: '1' },
          android: {
            alertTitle: 'Calls permission',
            alertDescription: 'Platinum Circles needs to manage calls so you can answer from the lock screen.',
            cancelButton: 'Cancel', okButton: 'Allow', additionalPermissions: [],
            foregroundService: { channelId: 'app.platinumcircles.calls', channelName: 'Ongoing calls', notificationTitle: 'Call in progress' },
          },
        });
        setupReady = true;
        // The event may precede listener registration when the OS launched a killed app.
        if (typeof RNCallKeep.getInitialEvents === 'function') {
          void Promise.resolve(RNCallKeep.getInitialEvents()).then(events => {
            replayNativeActions(events);
            RNCallKeep.clearInitialEvents?.();
          }).catch(() => {});
        }
        flushNativeActions();
        return true;
      } catch {
        for (const subscription of subscriptions) { try { subscription?.remove(); } catch {} }
        console.log('NATIVE_CALL_SETUP_FAILED');
        return false;
      }
    })();
    setupPromise = pending;
    void pending.finally(() => { if (setupPromise === pending) setupPromise = null; });
    return pending;
  },

  listen(events: NativeCallEvents): () => void {
    const owner = { events };
    activeEvents = owner;
    flushNativeActions();
    void nativeCallService.setup();
    return () => { if (activeEvents === owner) activeEvents = null; };
  },

  /** Register/replay one current token callback without replacing call replay. */
  registerVoipToken(onToken: (token: string) => void): void {
    if (!loadNatives() || Platform.OS !== 'ios' || !VoipPushNotification) return;
    tokenHandler = onToken;
    try {
      ensureVoipListeners();
      if (cachedToken) onToken(cachedToken);
      VoipPushNotification.registerVoipToken();
    } catch { console.log('VOIP_TOKEN_REGISTRATION_FAILED'); }
  },

  /** PushKit has already reported the call natively; this only reconciles JavaScript. */
  listenForVoipPushes(callback: (callId: string, recipientId?: string) => void): () => void {
    if (!loadNatives() || Platform.OS !== 'ios' || !VoipPushNotification) return () => {};
    const owner = { callback };
    reportHandler = owner;
    try {
      ensureVoipListeners();
      for (const report of pendingReports.splice(0)) if (Date.now() - report.receivedAt <= 45000) callback(report.callId, report.recipientId);
    } catch { console.log('VOIP_CALL_LISTENER_FAILED'); }
    return () => { if (reportHandler === owner) reportHandler = null; };
  },

  /**
   * Android: bring CallKeep up from a context that has no React tree.
   *
   * When a data message wakes a killed app there is no navigator, no auth
   * store and no mounted component, so the ordinary setup path has not run.
   * This registers just enough for displayIncomingCall to draw the OS call
   * screen. Answer and end events are picked up by IncomingCallListener once
   * the app is actually opened, which is exactly when they can be acted on.
   */
  async prepareForIncomingCall(): Promise<boolean> {
    if (!loadNatives() || Platform.OS !== 'android') return false;
    try {
      if (!await nativeCallService.setup()) return false;
      RNCallKeep.setAvailable(true);
      return true;
    } catch (e) {
      console.log('[NativeCalls] background prepare failed:', (e as any)?.message);
      return false;
    }
  },

  /** Show the OS incoming-call screen (rings natively, works locked). */
  displayIncomingCall(callUuid: string, callerName: string, hasVideo: boolean): boolean {
    if (!loadNatives()) return false;
    try {
      RNCallKeep.displayIncomingCall(callUuid, callerName, callerName, 'generic', hasVideo);
      return true;
    } catch (e) {
      console.log('[NativeCalls] displayIncomingCall failed:', (e as any)?.message);
      return false;
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
