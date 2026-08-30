/**
 * callBackgroundTask - the Android killed-app ring.
 *
 * A notification message is drawn by the system, which is why a killed phone
 * already rings today, but the system draws a notification, not a call screen.
 * To get the full screen answer and decline UI that a phone call deserves, the
 * server sends a data-only message instead. Android hands a data-only message
 * to this task even when the app is not running, and the task asks CallKeep to
 * draw the real call screen.
 *
 * The fallback matters as much as the happy path. If CallKeep cannot start,
 * which is possible on devices that restrict background work, the task posts
 * the same ringing notification the app would otherwise have received. So the
 * worst case is exactly today's behaviour rather than a silent phone.
 */
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { nativeCallService } from './nativeCallService';

export const INCOMING_CALL_TASK = 'INCOMING_CALL_TASK';

type CallData = {
  type?: string;
  call_id?: string;
  callId?: string;
  caller_name?: string;
  is_video?: boolean | string;
};

function readCallData(raw: any): CallData | null {
  // Expo delivers the FCM message under different shapes depending on whether
  // the app was alive, so check the places it can be before giving up.
  const candidates = [
    raw?.data?.notification?.data,
    raw?.data?.data,
    raw?.notification?.data,
    raw?.data,
    raw,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'object' && (c.call_id || c.callId)) return c as CallData;
  }
  return null;
}

async function ringFallback(callId: string, callerName: string, isVideo: boolean) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: callerName,
        body: isVideo ? 'Incoming video call' : 'Incoming call',
        data: { type: 'incoming_call', call_id: callId, caller_name: callerName, is_video: isVideo },
        categoryIdentifier: 'incoming_call',
        sound: 'default',
      },
      trigger: null,
    });
  } catch (e) {
    console.log('[CallTask] fallback notification failed:', (e as any)?.message);
  }
}

TaskManager.defineTask(INCOMING_CALL_TASK, async ({ data, error }: any) => {
  if (error) {
    console.log('[CallTask] error:', error?.message);
    return;
  }
  const call = readCallData(data);
  if (!call) return;
  if (call.type && call.type !== 'incoming_call') return;

  const callId = String(call.call_id || call.callId || '').toLowerCase();
  if (!callId) return;
  const callerName = String(call.caller_name || 'Platinum Circles');
  const isVideo = call.is_video === true || call.is_video === 'true';

  const ready = await nativeCallService.prepareForIncomingCall();
  if (!ready) {
    await ringFallback(callId, callerName, isVideo);
    return;
  }
  try {
    nativeCallService.displayIncomingCall(callId, callerName, isVideo);
  } catch (e) {
    console.log('[CallTask] displayIncomingCall failed:', (e as any)?.message);
    await ringFallback(callId, callerName, isVideo);
  }
});

/** Register the task. Android only: iOS rings through PushKit and CallKit. */
export async function registerIncomingCallTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.registerTaskAsync(INCOMING_CALL_TASK);
  } catch (e) {
    console.log('[CallTask] register failed:', (e as any)?.message);
  }
}
