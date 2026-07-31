/**
 * NewPostsPill v2 - the honest version. It appears ONLY when posts
 * exist that are (a) newer than everything currently loaded in the
 * feed, and (b) not your own. The baseline advances whenever the feed
 * hands down a fresher latest timestamp or you tap the pill, so it can
 * never nag about content you are already looking at.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

const POLL_MS = 45000;

export default function NewPostsPill(props: any) {
  const insets = useSafeAreaInsets();
  const [fresh, setFresh] = useState(0);
  const baselineRef = useRef<string>(new Date().toISOString());
  const latest: string | null = props?.latestCreatedAt ?? props?.latest ?? null;

  useEffect(() => {
    if (latest && latest > baselineRef.current) {
      baselineRef.current = latest;
      setFresh(0);
    }
  }, [latest]);

  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        const myId = useAuthStore.getState().profile?.id ?? null;
        let q = supabase.from('posts')
          .select('id', { count: 'exact', head: true })
          .gt('created_at', baselineRef.current);
        if (myId) q = q.neq('user_id', myId);
        const { count } = await q;
        if (alive) setFresh(count ?? 0);
      } catch {}
    };
    const t = setInterval(probe, POLL_MS);
    const first = setTimeout(probe, 8000);
    return () => { alive = false; clearInterval(t); clearTimeout(first); };
  }, []);

  if (fresh <= 0) return null;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Load new posts"
      onPress={() => {
        baselineRef.current = new Date().toISOString();
        setFresh(0);
        (props?.onPress ?? props?.onRefresh ?? (() => {}))();
      }}
      style={[s.pill, { top: insets.top + 8 }]}
    >
      <Feather name="arrow-up" size={13} color="#FFFFFF" />
      <Text style={s.txt}>{fresh === 1 ? 'New post' : fresh + ' new posts'}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  pill: {
    position: 'absolute', alignSelf: 'center', zIndex: 50,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#0B1E3D', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  txt: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});