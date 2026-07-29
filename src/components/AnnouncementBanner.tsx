/**
 * The platform's voice. Shows the newest active announcement from
 * operations at the top of the feed. Dismiss hides it for this session.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { supabase } from '../services/supabase';

export default function AnnouncementBanner() {
  const [note, setNote] = useState<{ id: string; title: string; body: string } | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from('announcements')
        .select('id, title, body').eq('active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (alive && data) setNote(data);
    })();
    return () => { alive = false; };
  }, []);
  if (!note || hidden) return null;
  return (
    <View style={{
      marginHorizontal: 14, marginTop: 4, marginBottom: 8, borderRadius: 12,
      backgroundColor: 'rgba(11,30,61,0.05)', borderWidth: 1, borderColor: 'rgba(11,30,61,0.1)',
      paddingVertical: 10, paddingHorizontal: 12,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '800', color: '#0B1E3D' }} numberOfLines={1}>{note.title}</Text>
        <TouchableOpacity onPress={() => setHidden(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ fontSize: 16, color: 'rgba(11,30,61,0.45)', fontWeight: '700' }}>{'\u00d7'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ fontSize: 12.5, lineHeight: 18, color: 'rgba(11,30,61,0.7)', marginTop: 2 }}>{note.body}</Text>
    </View>
  );
}