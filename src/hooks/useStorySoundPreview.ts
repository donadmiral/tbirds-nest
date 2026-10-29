import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { storiesService, type StoryAudioDraft } from '../services/storiesService';
import { hydrateUploadMedia } from '../services/contentMedia';

/** A draft stores a sound ID; short-lived playback URLs stay in render state. */
export function useStorySoundPreview(audio: StoryAudioDraft | null | undefined, owner: string | null | undefined) {
  const kind = audio?.kind, soundId = audio?.soundId, localUri = audio?.localUri, sourceUrl = audio?.url;
  const key = JSON.stringify([owner, kind, soundId, localUri, sourceUrl]);
  const [result, setResult] = useState<{ key: string; url: string | null; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true, generation = 0;
    const load = async () => {
      const request = ++generation;
      try {
        let url: string | null = null;
        if (owner && kind === 'sound' && soundId) url = (await storiesService.getStorySound(soundId)).url;
        else if (owner && kind === 'voiceover') {
          if (localUri && /^(file|content):/.test(localUri)) url = localUri;
          else if (sourceUrl) url = (await hydrateUploadMedia([{ url: sourceUrl }]))[0]?.url ?? null;
        }
        if (alive && request === generation) setResult({ key, url, error: kind && !url ? 'Sound could not load. Tap to retry.' : null });
      } catch {
        if (alive && request === generation) setResult({ key, url: null, error: 'Sound could not load. Tap to retry.' });
      }
    };
    void load();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 240000);
    const app = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { alive = false; generation++; clearInterval(timer); app.remove(); };
  }, [key, owner, kind, soundId, localUri, sourceUrl, attempt]);
  return { url: result?.key === key ? result.url : null, error: result?.key === key ? result.error : null, retry: () => setAttempt(n => n + 1) };
}
