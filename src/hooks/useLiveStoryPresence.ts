import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { createLiveStoryPresence, liveStorySessions, LIVE_STORY_PRESENCE_TTL } from '../../shared/liveStoryPresence';
import { navigationScope, subscribeNavigationScope } from '../lib/navigationCache';
import { supabase } from '../services/supabase';

const presence = createLiveStoryPresence(async (filter, signal) => {
  const { data, error } = await supabase.rpc('live_directory', {
    p_filter: filter, p_state: 'live', p_topic: null, p_cursor: null, p_limit: filter === 'mine' ? 1 : 24,
  }).abortSignal(signal);
  if (error) throw error;
  return data;
});
subscribeNavigationScope(() => presence.reset(navigationScope()));

export function useLiveStoryPresence() {
  const scope = useSyncExternalStore(subscribeNavigationScope, navigationScope, () => null);
  const snapshot = useSyncExternalStore(presence.subscribe, presence.getSnapshot, presence.getServerSnapshot);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [, tick] = useState(0);
  useEffect(() => { const listener = AppState.addEventListener('change', state => setActive(state === 'active')); return () => listener.remove(); }, []);
  useFocusEffect(useCallback(() => {
    if (!scope || !active) return;
    void presence.refresh(scope, true);
    const timer = setInterval(() => { tick(value => value + 1); void presence.refresh(scope, true); }, LIVE_STORY_PRESENCE_TTL);
    return () => clearInterval(timer);
  }, [scope, active]));
  useEffect(() => {
    if (!active || snapshot.scope !== scope || !snapshot.checkedAt) return;
    const remaining = snapshot.checkedAt + LIVE_STORY_PRESENCE_TTL - Date.now();
    if (remaining <= 0) return;
    const expiry = setTimeout(() => tick(value => value + 1), remaining + 1);
    return () => clearTimeout(expiry);
  }, [active, scope, snapshot.scope, snapshot.checkedAt]);
  return active ? liveStorySessions(snapshot, scope) : [];
}
