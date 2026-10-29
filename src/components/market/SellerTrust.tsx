import { themedSheet, useTheme } from '../../theme/useTheme';
import TierName from '../TierName';
import VerifiedBadge from '../VerifiedBadge';
/**
 * SellerTrust - account age, completed deals, rating and verification.
 * The cheapest fraud deterrent: a new account with no history looks like one.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { profileRead } from '../../utils/profileRead';

export default function SellerTrust({ sellerId }: { sellerId: string }) {
  const { t } = useTheme();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let off = false;
    setD(null); setError(false);
    (async () => {
      try {
        const [{ data: prof, error: profileError }, { count: sold, error: soldError }, { data: rate, error: ratingError }] = await Promise.all([
          profileRead(supabase.from('profiles').select('created_at, is_verified').eq('id', sellerId).maybeSingle()),
          profileRead(supabase.from('marketplace_listings').select('id', { count: 'exact', head: true })
            .eq('seller_id', sellerId).eq('status', 'sold')),
          profileRead(supabase.rpc('get_seller_rating', { p_seller_id: sellerId })),
        ]);
        if (off) return;
        if (profileError || soldError || ratingError) throw profileError || soldError || ratingError;
        const r = Array.isArray(rate) ? rate[0] : rate;
        setD({
          sellerId,
          joined: prof?.created_at ? new Date(prof.created_at) : null,
          verified: !!prof?.is_verified,
          sold: sold ?? 0,
          avg: Number(r?.avg_rating ?? 0),
          reviews: Number(r?.review_count ?? 0),
        });
      } catch { if (!off) setError(true); }
    })();
    return () => { off = true; };
  }, [sellerId, attempt]);

  if (error) return <TouchableOpacity accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={s.retry}><Text style={s.pillTxt}>Seller history could not load. Tap to retry.</Text></TouchableOpacity>;
  if (!d || d.sellerId !== sellerId) return null;

  const months = d.joined ? Math.max(0, Math.round((Date.now() - d.joined.getTime()) / 2592000000)) : null;
  const age = months === null ? null
    : months < 1 ? 'Joined this month'
    : months < 12 ? 'Member ' + months + ' months'
    : 'Member since ' + d.joined.getFullYear();
  const isNew = months !== null && months < 1 && d.sold === 0 && d.reviews === 0;

  const pill = (icon: React.ComponentProps<typeof Feather>['name'], text: string, warn = false) => (
    <View style={[s.pill, warn && s.pillWarn]}>
      <Feather name={icon} size={11} color={warn ? t.status.innovation : t.ink.secondary} />
      <Text style={[s.pillTxt, warn && s.pillTxtWarn]}>{text}</Text>
    </View>
  );

  return (
    <View style={s.wrap}>
      {d.verified && (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <VerifiedBadge userId={sellerId} size={13} />
          <TierName userId={sellerId} baseStyle={{ fontSize: 11.5, fontWeight: '700', color: t.ink.primary, marginLeft: 2 }} text={'Verified'} />
        </View>
      )}
      {!!age && pill('calendar', age)}
      {d.sold > 0 && pill('package', d.sold + ' sold')}
      {d.reviews > 0 && pill('star', d.avg.toFixed(1) + ' (' + d.reviews + ')')}
      {isNew && pill('alert-triangle', 'New seller', true)}
    </View>
  );
}

const s = themedSheet((t) => ({
  retry: { minHeight: 44, justifyContent: 'center', marginTop: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.surface.sunken, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  pillWarn: { backgroundColor: t.status.innovationBg },
  pillTxt: { fontSize: 11.5, fontWeight: '600', color: t.ink.secondary },
  pillTxtWarn: { color: t.ink.primary },
}));