/**
 * SellerReviews - Google-style rating summary plus review list and composer.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';

const GOLD = '#F5A623';
const NAVY = '#0B1E3D';

function Stars({ value, size = 14, onPick }: { value: number; size?: number; onPick?: (n: number) => void }) {
  const gap = Math.max(2, Math.round(size * 0.12));
  const rowW = size * 5 + gap * 4;
  const pct = Math.max(0, Math.min(1, value / 5));

  if (onPick) {
    return (
      <View style={{ flexDirection: 'row', gap }}>
        {[1, 2, 3, 4, 5].map(n => (
          <TouchableOpacity key={n} onPress={() => onPick(n)} activeOpacity={0.7}>
            <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? GOLD : '#C7C7CC'} />
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <View style={{ width: rowW, height: size }}>
      <View style={{ flexDirection: 'row', gap }}>
        {[0, 1, 2, 3, 4].map(i => (
          <Ionicons key={'b' + i} name="star" size={size} color="#E6E6EA" />
        ))}
      </View>
      <View style={{ position: 'absolute', left: 0, top: 0, width: rowW * pct, height: size, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', gap, width: rowW }}>
          {[0, 1, 2, 3, 4].map(i => (
            <Ionicons key={'f' + i} name="star" size={size} color={GOLD} />
          ))}
        </View>
      </View>
    </View>
  );
}

export default function SellerReviews({ sellerId, listingId, currentUserId }: { sellerId: string; listingId?: string; currentUserId?: string | null }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [writing, setWriting] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data: sum }, { data: list }] = await Promise.all([
        supabase.rpc('get_seller_rating', { p_seller_id: sellerId }),
        supabase.from('seller_reviews')
          .select('id, rating, comment, created_at, reviewer:profiles!seller_reviews_reviewer_id_fkey(id, full_name, avatar_url)')
          .eq('seller_id', sellerId).order('created_at', { ascending: false }).limit(20),
      ]);
      setSummary(Array.isArray(sum) ? sum[0] : sum);
      setReviews(list || []);
    } catch (e) { console.log('[SellerReviews]', e); }
    finally { setLoading(false); }
  }, [sellerId]);

  useEffect(() => { load(); }, [load]);

  const submit = useCallback(async () => {
    if (rating < 1) { Alert.alert('Pick a rating', 'Choose between one and five stars.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('seller_reviews').upsert({
        seller_id: sellerId, reviewer_id: currentUserId, listing_id: listingId ?? null,
        rating, comment: comment.trim() || null, updated_at: new Date().toISOString(),
      }, { onConflict: 'seller_id,reviewer_id,listing_id' });
      if (error) { Alert.alert('Could not post', error.message); return; }
      setWriting(false); setRating(0); setComment('');
      load();
    } finally { setBusy(false); }
  }, [rating, comment, sellerId, listingId, currentUserId, load]);

  if (loading) return <View style={s.center}><ActivityIndicator /></View>;

  const avg = Number(summary?.avg_rating ?? 0);
  const count = Number(summary?.review_count ?? 0);
  const bars = [
    { n: 5, v: Number(summary?.five ?? 0) }, { n: 4, v: Number(summary?.four ?? 0) },
    { n: 3, v: Number(summary?.three ?? 0) }, { n: 2, v: Number(summary?.two ?? 0) },
    { n: 1, v: Number(summary?.one ?? 0) },
  ];
  const canReview = !!currentUserId && currentUserId !== sellerId;

  return (
    <View style={s.wrap}>
      <Text style={s.heading}>Seller reviews</Text>

      {count === 0 ? (
        <Text style={s.none}>No reviews yet.</Text>
      ) : (
        <View style={s.summary}>
          <View style={s.scoreCol}>
            <Text style={s.score}>{avg.toFixed(1)}</Text>
            <Stars value={avg} size={13} />
            <Text style={s.countTxt}>{count} {count === 1 ? 'review' : 'reviews'}</Text>
          </View>
          <View style={s.barsCol}>
            {bars.map(b => (
              <View key={b.n} style={s.barRow}>
                <Text style={s.barNum}>{b.n}</Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: (count ? (b.v / count) * 100 : 0) + '%' } as any]} />
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {canReview && !writing && (
        <TouchableOpacity style={s.writeBtn} onPress={() => setWriting(true)} activeOpacity={0.8}>
          <Feather name="edit-2" size={14} color={NAVY} />
          <Text style={s.writeTxt}>Write a review</Text>
        </TouchableOpacity>
      )}

      {writing && (
        <View style={s.composer}>
          <Stars value={rating} size={26} onPick={setRating} />
          <TextInput
            style={s.input}
            value={comment}
            onChangeText={setComment}
            placeholder="Share how the deal went"
            placeholderTextColor="#B0B0B5"
            multiline
          />
          <View style={s.composerActions}>
            <TouchableOpacity onPress={() => setWriting(false)}><Text style={s.cancel}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[s.post, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={s.postTxt}>Post</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {reviews.map(r => (
        <View key={r.id} style={s.review}>
          <View style={s.reviewHead}>
            <Text style={s.reviewer}>{r.reviewer?.full_name || 'Member'}</Text>
            <Stars value={r.rating} size={12} />
          </View>
          {!!r.comment && <Text style={s.comment}>{r.comment}</Text>}
          <Text style={s.date}>{new Date(r.created_at).toLocaleDateString()}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA', marginTop: 18 },
  center: { paddingVertical: 24, alignItems: 'center' },
  heading: { fontSize: 17, fontWeight: '800', color: '#0A0A0A', letterSpacing: -0.4, marginBottom: 12 },
  none: { fontSize: 14, color: '#8E8E93', paddingBottom: 8 },
  summary: { flexDirection: 'row', gap: 20, alignItems: 'center', marginBottom: 14 },
  scoreCol: { alignItems: 'center', gap: 4 },
  score: { fontSize: 38, fontWeight: '800', color: '#0A0A0A', letterSpacing: -1.5 },
  countTxt: { fontSize: 12, color: '#8E8E93' },
  barsCol: { flex: 1, gap: 4 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barNum: { fontSize: 11, color: '#8E8E93', width: 8 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#EFEFF4', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: GOLD, borderRadius: 3 },
  writeBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', backgroundColor: '#F2F2F7', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 14 },
  writeTxt: { fontSize: 14, fontWeight: '700', color: NAVY },
  composer: { backgroundColor: '#F7F8FA', borderRadius: 14, padding: 14, gap: 10, marginBottom: 14 },
  input: { minHeight: 60, fontSize: 14.5, color: '#0A0A0A', textAlignVertical: 'top' },
  composerActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16 },
  cancel: { fontSize: 14.5, color: '#8E8E93', fontWeight: '600' },
  post: { backgroundColor: NAVY, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 9 },
  postTxt: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  review: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EFEFF4' },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  reviewer: { fontSize: 14.5, fontWeight: '700', color: '#0A0A0A' },
  comment: { fontSize: 14, color: '#3C3C43', lineHeight: 19 },
  date: { fontSize: 11.5, color: '#8E8E93', marginTop: 5 },
});