/**
 * A poll on a post: options with live percentages, one vote per person,
 * the same get_poll and vote_poll calls the web uses.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/useTheme';

type Opt = { id: string; label: string; votes: number };
type Poll = { ends_at: string | null; total: number; my_option_id: string | null; options: Opt[] };

export default function PollCard({ postId }: { postId: string }) {
  const { t } = useTheme();
  const [poll, setPoll] = useState<Poll | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_poll', { p_post_id: postId });
    const rows: any[] = Array.isArray(data) ? data : [];
    if (!rows.length) return;
    const options: Opt[] = rows.map((r) => ({ id: String(r.option_id), label: String(r.label), votes: Number(r.votes || 0) }));
    setPoll({ ends_at: rows[0].ends_at ?? null, total: Number(rows[0].total ?? 0), my_option_id: rows[0].viewer_vote ? String(rows[0].viewer_vote) : null, options });
  }, [postId]);
  useEffect(() => { load(); }, [load]);
  if (!poll) return null;
  const closed = poll.ends_at ? new Date(poll.ends_at).getTime() < Date.now() : false;
  const voted = !!poll.my_option_id;
  const vote = async (id: string) => { if (voted || closed) return; await supabase.rpc('vote_poll', { p_post_id: postId, p_option_id: id }); load(); };
  return (
    <View style={{ marginTop: 10, gap: 8 }}>
      {poll.options.map((o) => {
        const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
        const mine = poll.my_option_id === o.id;
        return (
          <TouchableOpacity key={o.id} activeOpacity={0.8} onPress={() => vote(o.id)} disabled={voted || closed}
            style={{ borderRadius: 12, borderWidth: 1, borderColor: mine ? t.brand.base : t.surface.hairline, overflow: 'hidden', backgroundColor: t.surface.raised }}>
            {(voted || closed) ? <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: (pct + '%') as any, backgroundColor: mine ? 'rgba(11,30,61,0.16)' : 'rgba(11,30,61,0.07)' }} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11 }}>
              <Text style={{ fontSize: 14.5, fontWeight: mine ? '800' : '600', color: t.ink.primary, flexShrink: 1 }}>{o.label}</Text>
              {(voted || closed) ? <Text style={{ fontSize: 13, fontWeight: '800', color: t.ink.primary }}>{pct}%</Text> : null}
            </View>
          </TouchableOpacity>
        );
      })}
      <Text style={{ fontSize: 12, color: t.ink.muted }}>{poll.total} {poll.total === 1 ? 'vote' : 'votes'}{closed ? ' · Final results' : poll.ends_at ? ' · Ends ' + new Date(poll.ends_at).toLocaleDateString() : ''}</Text>
    </View>
  );
}

const st = StyleSheet.create({});