/**
 * Android incoming calls, the WhatsApp way: a full-screen call notification
 * with the ringtone and Answer/Decline, shown even when the phone is locked
 * and the app is closed. The push that triggers it is a high-priority data
 * message; iOS never comes here (CallKit rings there).
 *
 * notifee is the library that can post a full-screen, ongoing, CALL-category
 * notification. If it isn't compiled into the running client, the ordinary
 * notification with actions is used instead, so nothing ever rings silently.
 */
import { Platform } from 'react-native';
import { declineIncomingCall, parseCallPayload, readIncomingCall, type IncomingCallPayload, type IncomingCallSession } from './incomingCallAccess';
export { parseCallPayload, type IncomingCallPayload } from './incomingCallAccess';

let notifee: any = null;
try { notifee = require('@notifee/react-native').default; } catch { notifee = null; }

export const CALL_CHANNEL_ID = 'calls';
const RING_TIMEOUT_MS = 45000;

export async function ensureCallChannel(): Promise<void> {
  if (Platform.OS !== 'android' || !notifee) return;
  try {
    await notifee.createChannel({ id: CALL_CHANNEL_ID, name: 'Calls', importance: 4, sound: 'incallmanager_ringtone', vibration: true, vibrationPattern: [300, 500, 300, 500], bypassDnd: true, visibility: 1 });
  } catch {}
}

/** Show the full-screen incoming call. Returns true when notifee handled it. */
export async function showIncomingCall(payload: IncomingCallPayload, session: IncomingCallSession): Promise<boolean> {
  if (Platform.OS !== 'android' || !notifee || !session.current()) return false;
  try {
    await ensureCallChannel();
    session.ensure();
    // OS channel setup can outlast the invitation or the caller's cancellation.
    const resolved = await readIncomingCall(payload, session);
    session.ensure();
    if (!resolved) return false;
    const p = resolved.payload;
    const expiresAt = p.expiresAt ?? Date.now() + RING_TIMEOUT_MS;
    const remaining = Math.min(RING_TIMEOUT_MS, expiresAt - Date.now());
    if (remaining <= 0) return false;
    await notifee.displayNotification({
      id: 'call-' + p.callId,
      title: p.callerName,
      body: p.isVideo ? 'Incoming video call' : 'Incoming voice call',
      data: { type: 'incoming_call', call_id: p.callId, callerName: p.callerName, isVideo: p.isVideo ? '1' : '0', conversation_id: p.conversationId || '', recipient_id: p.recipientId || '' },
      android: {
        channelId: CALL_CHANNEL_ID,
        category: 'call',
        importance: 4,
        ongoing: true,
        autoCancel: false,
        loopSound: true,
        sound: 'incallmanager_ringtone',
        timeoutAfter: Math.max(1, Math.floor(remaining)),
        largeIcon: p.callerAvatar || undefined,
        smallIcon: 'notification_icon',
        color: '#0B1E3D',
        fullScreenAction: { id: 'incoming', launchActivity: 'default' },
        pressAction: { id: 'incoming', launchActivity: 'default' },
        actions: [
          { title: 'Answer', pressAction: { id: 'answer', launchActivity: 'default' } },
          { title: 'Decline', pressAction: { id: 'decline' } },
        ],
      },
    });
    if (!session.current() || expiresAt <= Date.now()) { await dismissIncomingCall(p.callId); return false; }
    return true;
  } catch (e: any) {
    console.log('[AndroidCall] display failed:', e?.message);
    return false;
  }
}

export async function dismissIncomingCall(callId: string): Promise<void> {
  if (!notifee) return;
  try { await notifee.cancelNotification('call-' + callId); } catch {}
}

/**
 * Background events: Decline pressed with the app closed ends the call on the
 * server and removes the notification. Registered once at module load.
 */
if (Platform.OS === 'android' && notifee) {
  try {
    notifee.onBackgroundEvent(async ({ type, detail }: any) => {
      const payload = parseCallPayload(detail?.notification?.data);
      if (!payload) return;
      if (type === 2 /* ACTION_PRESS */ && detail?.pressAction?.id === 'decline') {
        try {
          if (await declineIncomingCall(payload)) await dismissIncomingCall(payload.callId);
        } catch { /* A failed network decline remains available to retry. */ }
      } else if (type === 0 /* DISMISSED */) {
        await dismissIncomingCall(payload.callId);
      }
    });
  } catch {}
}

/**
 * What to do when the app opens because of the call notification: returns the
 * payload and whether Answer was pressed, so the navigator can open the call.
 */
export async function consumeInitialCallNotification(): Promise<{ payload: IncomingCallPayload; answer: boolean } | null> {
  if (Platform.OS !== 'android' || !notifee) return null;
  try {
    const initial = await notifee.getInitialNotification();
    const p = parseCallPayload(initial?.notification?.data);
    const action = initial?.pressAction?.id;
    if (!p || !['incoming', 'answer', 'default'].includes(action)) return null;
    return { payload: p, answer: action === 'answer' };
  } catch { return null; }
}

/** Foreground presses while the app is running. */
export function listenForegroundCallActions(handler: (payload: IncomingCallPayload, action: 'answer' | 'decline' | 'open') => void): () => void {
  if (Platform.OS !== 'android' || !notifee) return () => {};
  try {
    return notifee.onForegroundEvent(({ type, detail }: any) => {
      const p = parseCallPayload(detail?.notification?.data);
      if (!p) return;
      const id = detail?.pressAction?.id;
      if (type === 1 /* PRESS */ && ['incoming', 'default'].includes(id)) handler(p, 'open');
      else if (type === 2 /* ACTION_PRESS */ && (id === 'answer' || id === 'decline')) handler(p, id);
    });
  } catch { return () => {}; }
}
