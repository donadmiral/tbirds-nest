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
import { showIncomingCall } from './androidCallNotification';
import { parseCallPayload, readIncomingCall, withIncomingCallSession, type IncomingCallPayload, type IncomingCallSession } from './incomingCallAccess';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { nativeCallService } from './nativeCallService';

// expo-task-manager is a NATIVE module, so it only exists in a build that was
// compiled with it. A dev client built before it was added does not have it,
// and a plain import would throw at startup and take the whole app down. So it
// is required lazily and every use is guarded: on an older build the app runs
// exactly as it did, and the call still rings through the notification path.
let TaskManager: any = null;
try {
  TaskManager = require('expo-task-manager');
} catch {
  TaskManager = null;
}

export const INCOMING_CALL_TASK = 'INCOMING_CALL_TASK';

function readCallData(raw: unknown): IncomingCallPayload | null {
  const value = raw as { data?: { notification?: { data?: unknown }; data?: unknown }; notification?: { data?: unknown } } | null;
  const candidates = [value?.data?.notification?.data, value?.data?.data, value?.notification?.data, value?.data, raw];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const body = (candidate as { body?: unknown }).body;
    let data: unknown = body ?? candidate;
    if (typeof data === 'string') {
      if (data.length > 16_384) continue;
      try { data = JSON.parse(data); } catch { continue; }
    }
    const payload = parseCallPayload(data);
    if (payload) return payload;
  }
  return null;
}

async function ringFallback(call: IncomingCallPayload, session: IncomingCallSession) {
  session.ensure();
  if (!call.expiresAt || call.expiresAt <= Date.now()) return;
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: call.callerName,
      body: call.isVideo ? 'Incoming video call' : 'Incoming call',
      data: { type: 'incoming_call', call_id: call.callId, caller_name: call.callerName,
        is_video: !!call.isVideo, recipient_id: session.userId, conversation_id: call.conversationId },
      categoryIdentifier: 'incoming_call', sound: 'default',
    },
    trigger: null,
  });
  if (!session.current() || call.expiresAt <= Date.now()) await Notifications.dismissNotificationAsync(id).catch(() => {});
}

const pendingCalls = new Map<string, Promise<void>>();

export async function handleIncomingCallTask({ data, error }: { data?: unknown; error?: unknown }): Promise<void> {
  if (Platform.OS !== 'android' || error) return;
  const payload = readCallData(data);
  if (!payload) return;
  const pending = pendingCalls.get(payload.callId);
  if (pending) return pending;
  if (pendingCalls.size >= 16) return;
  const task = withIncomingCallSession(payload, async session => {
    const fresh = await readIncomingCall(payload, session);
    if (!fresh) return;
    if (await showIncomingCall(fresh.payload, session)) return;
    session.ensure();
    if (!await readIncomingCall(payload, session)) return;
    const ready = await nativeCallService.prepareForIncomingCall();
    session.ensure();
    // Preparing the native surface may take long enough for a caller to cancel.
    const current = await readIncomingCall(payload, session);
    if (!current) return;
    if (ready && nativeCallService.displayIncomingCall(current.call.id, current.payload.callerName, !!current.payload.isVideo)) return;
    await ringFallback(current.payload, session);
  }).catch(() => { /* Failed or stale delivery cannot ring a different account. */ })
    .finally(() => { if (pendingCalls.get(payload.callId) === task) pendingCalls.delete(payload.callId); });
  pendingCalls.set(payload.callId, task);
  return task;
}

if (TaskManager?.defineTask) TaskManager.defineTask(INCOMING_CALL_TASK, handleIncomingCallTask);

/** Register the task. Android only: iOS rings through PushKit and CallKit. */
export async function registerIncomingCallTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!TaskManager?.defineTask) return; // older build without the native module
  try {
    await Notifications.registerTaskAsync(INCOMING_CALL_TASK);
  } catch (e) {
    console.log('[CallTask] register failed:', (e as any)?.message);
  }
}
