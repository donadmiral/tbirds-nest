/**
 * SellerTrust - account age, completed deals, rating and verification.
 * The cheapest fraud deterrent: a new account with no history looks like one.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';

export default function SellerTrust({ sellerId }: { sellerId: string }) {
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [{ data: prof }, { count: sold }, { data: rate }] = await Promise.all([
          supabase.from('profiles').select('created_at, is_verified').eq('id', sellerId).maybeSingle(),
          supabase.from('marketplace_listings').select('id', { count: 'exact', head: true })
            .eq('seller_id', sellerId).eq('status', 'sold'),
          supabase.rpc('get_seller_rating', { p_seller_id: sellerId }),
        ]);
        if (off) return;
        const r = Array.isArray(rate) ? rate[0] : rate;
        setD({
          joined: prof?.created_at ? new Date(prof.created_at) : null,
          verified: !!prof?.is_verified,
          sold: sold ?? 0,
          avg: Number(r?.avg_rating ?? 0),
          reviews: Number(r?.review_count ?? 0),
        });
      } catch (e) { console.log('[SellerTrust]', e); }
    })();
    return () => { off = true; };
  }, [sellerId]);

  if (!d) return null;

  const months = d.joined ? Math.max(0, Math.round((Date.now() - d.joined.getTime()) / 2592000000)) : null;
  const age = months === null ? null
    : months < 1 ? 'Joined this month'
    : months < 12 ? 'Member ' + months + ' months'
    : 'Member since ' + d.joined.getFullYear();
  const isNew = months !== null && months < 1 && d.sold === 0 && d.reviews === 0;

  const Pill = ({ icon, text, warn }: any) => (
    <View style={[s.pill, warn && s.pillWarn]}>
      <Feather name={icon} size={11} color={warn ? '#92400E' : '#4B5563'} />
      <Text style={[s.pillTxt, warn && s.pillTxtWarn]}>{text}</Text>
    </View>
  );

  return (
    <View style={s.wrap}>
      {d.verified && <Pill icon="check-circle" text="Verified" />}
      {!!age && <Pill icon="calendar" text={age} />}
      {d.sold > 0 && <Pill icon="package" text={d.sold + (d.sold === 1 ? ' sold' : ' sold')} />}
      {d.reviews > 0 && <Pill icon="star" text={d.avg.toFixed(1) + ' (' + d.reviews + ')'} />}
      {isNew && <Pill icon="alert-triangle" text="New seller" warn />}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  pillWarn: { backgroundColor: '#FEF3C7' },
  pillTxt: { fontSize: 11.5, fontWeight: '600', color: '#4B5563' },
  pillTxtWarn: { color: '#92400E' },
});