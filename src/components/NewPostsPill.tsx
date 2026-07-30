/**
 * NewPostsPill - the Twitter-style quiet poll. Every 45 seconds it asks
 * whether anything newer than the top card exists; if yes, a floating
 * pill invites the reader in. Content never moves on its own.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../services/supabase';

const NAVY = '#0B1E3D';

export default function NewPostsPill({ topCreatedAt, onPress }: { topCreatedAt?: string | null; onPress: () => void }) {
  const [fresh, setFresh] = useState(false);
  const topRef = useRef(topCreatedAt);
  topRef.current = topCreatedAt;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const top = topRef.current;
      if (!top || !alive) return;
      try {
        const { data } = await supabase.from('posts')
          .select('id').gt('created_at', top).limit(1);
        if (alive && data && data.length > 0) setFresh(true);
      } catch {}
    };
    const iv = setInterval(tick, 45000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  useEffect(() => { setFresh(false); }, [topCreatedAt]);

  if (!fresh) return null;
  return (
    <TouchableOpacity style={s.pill} activeOpacity={0.85} onPress={() => { setFresh(false); onPress(); }}>
      <Feather name="arrow-up" size={13} color="#FFFFFF" />
      <Text style={s.txt}>New posts</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  pill: {
    position: 'absolute', top: 10, alignSelf: 'center', zIndex: 50,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: NAVY, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  txt: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },
});