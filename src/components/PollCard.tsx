/**
 * A poll on a post: options with live percentages, one vote per person,
 * the same get_poll and vote_poll calls the web uses.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet , Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/useTheme';
import PollVotersSheet from './PollVotersSheet';
import { useAuthStore } from '../stores/authStore';
import { Feather } from '@expo/vector-icons';

type Opt = { id: string; label: string; votes: number };
type Poll = { ends_at: string | null; total: number; my_option_id: string | null; options: Opt[] };

export default function PollCard({ postId }: { postId: string }) {
  const { t } = useTheme();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [votersFor, setVotersFor] = useState<string | null>(null);
  const myId = useAuthStore((s: any) => s.profile?.id);
  const [authorId, setAuthorId] = useState<string | null>(null);
  useEffect(() => { supabase.from('posts').select('user_id').eq('id', postId).maybeSingle().then(({ data }) => setAuthorId((data as any)?.user_id ?? null)); }, [postId]);
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
  const showResults = voted || closed;
  const isAuthor = !!myId && myId === authorId;
  const vote = async (id: string) => { if (isAuthor) { setVotersFor(postId); return; } if (voted || closed) return; const { error } = await supabase.rpc('vote_poll', { p_post_id: postId, p_option_id: id }); if (error) { Alert.alert('Not counted', error.message); return; } load(); };
  return (
    <View style={{ marginTop: 12, paddingHorizontal: 16, gap: 8 }}>
      {poll.options.map((o) => {
        const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
        const mine = poll.my_option_id === o.id;
        const leading = showResults && poll.total > 0 && o.votes === Math.max(...poll.options.map((x) => x.votes));
        return (
          <TouchableOpacity key={o.id} activeOpacity={0.8} onPress={() => vote(o.id)} disabled={showResults && !isAuthor}
            style={{ height: 44, borderRadius: 12, borderWidth: mine ? 1.5 : 1, borderColor: mine ? t.brand.base : t.surface.hairline, overflow: 'hidden', backgroundColor: t.surface.raised, justifyContent: 'center' }}>
            {showResults ? <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: (Math.max(pct, 2) + '%') as any, backgroundColor: leading ? 'rgba(201,191,176,0.45)' : 'rgba(11,30,61,0.06)' }} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 }}>
              {mine ? <Feather name="check-circle" size={15} color={t.brand.base} /> : null}
              <Text style={{ flex: 1, fontSize: 15, fontWeight: leading || mine ? '700' : '600', color: t.ink.primary }} numberOfLines={1}>{o.label}</Text>
              {showResults ? <Text style={{ fontSize: 14, fontWeight: '700', color: leading ? t.ink.primary : t.ink.muted }}>{pct}%</Text> : null}
            </View>
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity disabled={!isAuthor} onPress={() => setVotersFor(postId)} activeOpacity={0.8}><Text style={{ fontSize: 12.5, color: t.ink.muted, marginTop: 2 }}>{poll.total} {poll.total === 1 ? 'vote' : 'votes'} · {closed ? 'Final results' : timeLeft(poll.ends_at)}{isAuthor ? ' · See votes' : ''}</Text></TouchableOpacity>
      <PollVotersSheet postId={votersFor} onClose={() => setVotersFor(null)} />
    </View>
  );
}

function timeLeft(iso: string | null): string {
  if (!iso) return 'Open';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Final results';
  const h = Math.floor(ms / 3600000);
  if (h >= 48) return Math.floor(h / 24) + 'd left';
  if (h >= 1) return h + 'h left';
  return Math.max(1, Math.floor(ms / 60000)) + 'm left';
}
const st = StyleSheet.create({});