/**
 * audioService.ts - call ring sounds, rebuilt on react-native-incall-manager.
 *
 * HISTORY (do not undo): expo-audio was PROVEN on 2026-07-28 to kill WebRTC
 * playout at the native level - both its setAudioModeAsync calls AND its
 * players, independently. It is banned from call flows forever.
 *
 * This engine uses react-native-incall-manager instead, the standard WebRTC
 * companion library. It plays:
 *   ringback - caller side, loops while the other phone rings
 *   ringtone - callee side, full-screen incoming call
 * The native module only exists in binaries built after 2026-08-01. On older
 * clients every method quietly no-ops, exactly like the gated era.
 *
 * KILL SWITCH: set RING_SOUNDS_ENABLED = false and reload metro if call
 * audio ever goes silent again. That restores the proven-working silence.
 *
 * Public API is unchanged: CallContext, CallScreen, IncomingCallScreen and
 * IncomingCallListener keep their existing calls.
 */
import { NativeModules } from 'react-native';

const RING_SOUNDS_ENABLED = true;

let ICM: any = null;
try {
  if ((NativeModules as any)?.InCallManager) {
    ICM = require('react-native-incall-manager').default;
  }
} catch (e) {
  ICM = null;
}
if (!ICM) console.log('[RING] native InCallManager absent on this binary - ring sounds off');

type SoundType = 'ringtone' | 'ringback';
let currentType: SoundType | null = null;

function ready(): boolean {
  return RING_SOUNDS_ENABLED && !!ICM;
}

export const audioService = {
  /** Callee side. Loops until stopped. Safe to call twice. */
  async playRingtone(): Promise<boolean> {
    if (!ready()) return false;
    if (currentType === 'ringtone') return true;
    try {
      ICM.startRingtone('_BUNDLE_');
      currentType = 'ringtone';
      console.log('[RING] ringtone started');
      return true;
    } catch (e) {
      console.log('[RING] ringtone error:', e);
      return false;
    }
  },

  /** Caller side. Loops until the callee joins. Safe to call twice. */
  async playRingback(): Promise<boolean> {
    if (!ready()) return false;
    if (currentType === 'ringback') return true;
    try {
      ICM.startRingback('_BUNDLE_');
      currentType = 'ringback';
      console.log('[RING] ringback started');
      return true;
    } catch (e) {
      console.log('[RING] ringback error:', e);
      return false;
    }
  },

  /** Ring sounds off, session untouched - Daily takes over next. */
  async stopAndSwitchToVoiceChat(): Promise<void> {
    if (!ICM) return;
    try { ICM.stopRingtone(); } catch {}
    try { ICM.stopRingback(); } catch {}
    if (currentType) console.log('[RING] stopped ' + currentType + ' (handing session to the call)');
    currentType = null;
  },

  /** Everything off - call is over or was declined. */
  async stopAll(): Promise<void> {
    if (!ICM) return;
    try { ICM.stopRingtone(); } catch {}
    try { ICM.stopRingback(); } catch {}
    if (currentType) console.log('[RING] stopped ' + currentType + ' (call over)');
    currentType = null;
  },

  /** WebRTC releases the session by itself now; nothing to reset. */
  async resetSession(): Promise<void> {},

  getPlayingSound(): SoundType | null { return currentType; },
  isPlaying(type: SoundType): boolean { return currentType === type; },
  isAnyPlaying(): boolean { return currentType !== null; },
};