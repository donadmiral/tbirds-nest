'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createClient } from './supabase/client';
import { getNavigationStore } from './navigationCache';
import { createLiveStoryPresence, liveStorySessions, LIVE_STORY_PRESENCE_TTL } from '../../shared/liveStoryPresence';

let browserPresence: ReturnType<typeof createLiveStoryPresence> | null = null;
function getPresence() {
  const create = () => createLiveStoryPresence(async (filter, signal) => {
    const { data, error } = await createClient().rpc('live_directory', {
      p_filter: filter, p_state: 'live', p_topic: null, p_cursor: null, p_limit: filter === 'mine' ? 1 : 24,
    }).abortSignal(signal);
    if (error) throw error;
    return data;
  });
  if (typeof window === 'undefined') return create();
  return browserPresence ??= create();
}
export function useLiveStoryPresence() {
  const [navigation] = useState(getNavigationStore), [presence] = useState(getPresence);
  const identity = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getServerSnapshot);
  const snapshot = useSyncExternalStore(presence.subscribe, presence.getSnapshot, presence.getServerSnapshot);
  const [visible, setVisible] = useState(true), [, tick] = useState(0);
  useEffect(() => {
    const refresh = (force = false) => { const current = !document.hidden; setVisible(current); tick(value => value + 1); if (current) void presence.refresh(identity.scope, force); };
    refresh(true);
    const timer = setInterval(() => refresh(true), LIVE_STORY_PRESENCE_TTL);
    const foreground = () => refresh(true);
    window.addEventListener('focus', foreground); document.addEventListener('visibilitychange', foreground);
    return () => { clearInterval(timer); window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground); };
  }, [identity.scope, presence]);
  useEffect(() => {
    if (!visible || snapshot.scope !== identity.scope || !snapshot.checkedAt) return;
    const remaining = snapshot.checkedAt + LIVE_STORY_PRESENCE_TTL - Date.now();
    if (remaining <= 0) return;
    const expiry = setTimeout(() => tick(value => value + 1), remaining + 1);
    return () => clearTimeout(expiry);
  }, [visible, identity.scope, snapshot.scope, snapshot.checkedAt]);
  return visible ? liveStorySessions(snapshot, identity.scope) : [];
}
