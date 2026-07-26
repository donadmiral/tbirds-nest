/**
 * audioService.ts
 *
 * Single source of truth for ALL call-related audio.
 * Handles: ringtone (incoming), ringback (outgoing waiting), call-end beep.
 *
 * Design:
 *  - Preloads assets on first use, caches Sound references.
 *  - Loop recovery: checks playback every 1.5s, restarts if interrupted.
 *  - Instant stop: stopAsync + unloadAsync, reference nulled immediately.
 *  - Silent mode: playsInSilentModeIOS = true on every play.
 *  - Duplicate guard: tracks current playing sound type, rejects double-play.
 *  - State tracking: internal enum, all reads go through getPlayingSound().
 *  - Logs: every play, stop, recovery, and error is logged.
 *
 * Usage:
 *   import { audioService } from './audioService';
 *   await audioService.playRingtone();    // incoming call
 *   await audioService.playRingback();    // outgoing waiting
 *   audioService.stopAll();               // instant stop, call ended
 *   audioService.getPlayingSound();       // 'ringtone' | 'ringback' | null
 */
// Migrated off expo-av 2026-07-25: deprecated and removed in a future SDK,
// which would have left incoming calls silent. Option names changed:
// playsInSilentModeIOS -> playsInSilentMode, staysActiveInBackground ->
// shouldPlayInBackground, allowsRecordingIOS -> allowsRecording,
// playThroughEarpieceAndroid -> shouldRouteThroughEarpiece, and the two
// per-platform interruption enums collapsed into one string union.
// shouldDuckAndroid is gone because 'duckOthers' already says it.
import { setAudioModeAsync, createAudioPlayer, type AudioPlayer } from 'expo-audio';

// Asset references - verified to exist at src/assets/sounds/
let ringtoneAsset: any = null;
let ringbackAsset: any = null;

try {
  ringtoneAsset = require('../assets/sounds/ringtone.wav');
} catch (e) {
  console.log('[AudioService] ringtone.wav not found');
}

try {
  ringbackAsset = require('../assets/sounds/ringback.wav');
} catch (e) {
  console.log('[AudioService] ringback.wav not found');
}

type SoundType = 'ringtone' | 'ringback';

// Internal state
let currentSound: AudioPlayer | null = null;
let currentType: SoundType | null = null;
let recoveryInterval: ReturnType<typeof setInterval> | null = null;
let stopping = false;

/**
 * Configure audio session for call sounds.
 * Must be called before every playback to reclaim the audio session
 * after interruptions (other apps, system sounds, Siri).
 */
async function configureAudioSession(): Promise<boolean> {
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
      shouldRouteThroughEarpiece: false,
    });
    return true;
  } catch (e) {
    console.log('[AudioService] configureAudioSession error:', e);
    return false;
  }
}

/**
 * Configure audio session for active voice/video call.
 * Switches to voice-chat mode so Daily.co audio works correctly.
 */
async function configureForVoiceChat(): Promise<boolean> {
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: true,
    });
    return true;
  } catch (e) {
    console.log('[AudioService] configureForVoiceChat error:', e);
    return false;
  }
}

/**
 * Reset audio session to default after call ends.
 */
async function resetAudioSession(): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
      shouldRouteThroughEarpiece: false,
    });
  } catch (e) {
    console.log('[AudioService] resetAudioSession error:', e);
  }
}

/**
 * Internal: create and play a sound with looping.
 * Replaces any currently playing sound.
 */
async function playSound(type: SoundType): Promise<boolean> {
  // Guard: already playing this sound
  if (currentType === type && currentSound !== null) {
    console.log('[AudioService] already playing', type);
    return true;
  }

  // Guard: stop in progress
  if (stopping) {
    console.log('[AudioService] stop in progress, skipping play', type);
    return false;
  }

  // Stop any existing sound first
  await doStop(false);

  const asset = type === 'ringtone' ? ringtoneAsset : ringbackAsset;
  if (!asset) {
    console.log('[AudioService] asset not found for', type);
    return false;
  }

  // Configure audio session
  const configured = await configureAudioSession();
  if (!configured) {
    console.log('[AudioService] audio session config failed for', type);
    return false;
  }

  try {
    const sound = createAudioPlayer(asset);
    sound.loop = true;
    sound.volume = type === 'ringtone' ? 1.0 : 0.5;
    sound.play();

    currentSound = sound;
    currentType = type;
    console.log('[AudioService] playing', type);

    // Start recovery loop
    startRecovery(type);

    return true;
  } catch (e) {
    console.log('[AudioService] play error for', type, e);
    currentSound = null;
    currentType = null;
    return false;
  }
}

/**
 * Recovery loop: checks every 1.5s if sound is still playing.
 * If interrupted (by system, other app, or audio session change),
 * reconfigures audio session and restarts playback.
 */
function startRecovery(type: SoundType): void {
  stopRecovery();

  recoveryInterval = setInterval(async () => {
    if (!currentSound || currentType !== type || stopping) {
      stopRecovery();
      return;
    }

    try {
      const status = { isLoaded: true, isPlaying: currentSound.playing };
      if (!status.isLoaded) {
        console.log('[AudioService] recovery: sound unloaded, recreating', type);
        await doStop(false);
        await playSound(type);
        return;
      }
      if (!status.isPlaying) {
        console.log('[AudioService] recovery: sound paused, restarting', type);
        await configureAudioSession();
        currentSound.play();
      }
    } catch (e) {
      console.log('[AudioService] recovery: error, recreating', type, e);
      await doStop(false);
      await playSound(type);
    }
  }, 1500);
}

/**
 * Stop the recovery interval.
 */
function stopRecovery(): void {
  if (recoveryInterval !== null) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }
}

/**
 * Internal: stop and unload the current sound.
 * @param resetSession - whether to reset audio session to default
 */
async function doStop(resetSession: boolean): Promise<void> {
  stopRecovery();

  const sound = currentSound;
  const type = currentType;

  // Null references immediately to prevent double-stop
  currentSound = null;
  currentType = null;

  if (sound) {
    try {
      sound.pause();
    } catch {}
    try {
      sound.remove();
    } catch {}
    console.log('[AudioService] stopped', type);
  }

  if (resetSession) {
    await resetAudioSession();
  }
}

// ── Public API ──────────────────────────────────────────────────

export const audioService = {
  /**
   * Play the incoming call ringtone. Loops until stopped.
   * Safe to call multiple times - will not double-play.
   */
  async playRingtone(): Promise<boolean> {
    return playSound('ringtone');
  },

  /**
   * Play the outgoing call ringback tone. Loops until stopped.
   * Safe to call multiple times - will not double-play.
   */
  async playRingback(): Promise<boolean> {
    return playSound('ringback');
  },

  /**
   * Stop all sounds immediately. Call this on:
   * - accept, decline, timeout, endCall, unmount
   * Resets audio session to default.
   */
  async stopAll(): Promise<void> {
    if (stopping) return;
    stopping = true;
    try {
      await doStop(true);
    } finally {
      stopping = false;
    }
  },

  /**
   * Stop all sounds but keep audio session configured for voice chat.
   * Call this when transitioning from ringing to active call.
   * The Daily.co audio session needs voice-chat mode, not default.
   */
  async stopAndSwitchToVoiceChat(): Promise<void> {
    if (stopping) return;
    stopping = true;
    try {
      await doStop(false);
      await configureForVoiceChat();
    } finally {
      stopping = false;
    }
  },

  /**
   * Reset audio session after call ends completely.
   * Call this after Daily.co cleanup is done.
   */
  async resetSession(): Promise<void> {
    await resetAudioSession();
  },

  /**
   * Get the currently playing sound type.
   * Returns null if nothing is playing.
   */
  getPlayingSound(): SoundType | null {
    return currentType;
  },

  /**
   * Check if a specific sound is currently playing.
   */
  isPlaying(type: SoundType): boolean {
    return currentType === type && currentSound !== null;
  },

  /**
   * Check if any sound is currently playing.
   */
  isAnyPlaying(): boolean {
    return currentSound !== null;
  },
};