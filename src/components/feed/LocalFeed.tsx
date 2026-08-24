import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator, RefreshControl } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';

// Local: the Zimbabwe commerce surface. Mirrors web/components/LocalFeed.tsx.
const CITIES = ['All Zimbabwe', 'Harare', 'Bulawayo', 'Mutare', 'Gweru', 'Masvingo'];
const NAVY = '#0B1E3D';

export default function LocalFeed({ navigation }: { navigation: any }) {
  const [city, setCity] = useState('All Zimbabwe');
  const [listings, setListings] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [bizPosts, setBizPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('pc_local_city').then(c => { if (c && CITIES.includes(c)) setCity(c); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [ls, jb, fp] = await Promise.all([
        supabase.from('marketplace_listings').select('*').order('created_at', { ascending: false }).limit(30),
        supabase.from('jobs').select('*').order('created_at', { ascending: false }).limit(30),
        supabase.rpc('get_feed', { p_mode: 'latest', p_cursor_key: null, p_cursor_id: null, p_limit: 40 }),
      ]);
      setListings(((ls.data ?? []) as any[]).filter(l => !l.status || l.status === 'active'));
      setJobs((jb.data ?? []) as any[]);
      setBizPosts(((fp.data ?? []) as any[]).filter(r => r.author_kind === 'business' && !r.reposted_by_id).slice(0, 4));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pick = (c: string) => { setCity(c); AsyncStorage.setItem('pc_local_city', c).catch(() => {}); };
  const inCity = (loc: any) => city === 'All Zimbabwe' || String(loc ?? '').toLowerCase().includes(city.toLowerCase());
  const shownListings = listings.filter(l => inCity(l.location_city)).slice(0, 8);
  const shownJobs = jobs.filter(j => inCity(j.location)).slice(0, 6);
  const listingImg = (l: any): string | null => (Array.isArray(l.image_urls) && l.image_urls[0]) || l.image_url || null;
  const priceTxt = (l: any) => (l.currency ? l.currency + ' ' : '$') + String(l.price ?? '');

  const H = ({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) => (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 20, paddingBottom: 8 }}>
      <Text style={{ fontSize: 15.5, fontWeight: '800', color: '#0A0A0A' }}>{title}</Text>
      {onSeeAll ? <TouchableOpacity onPress={onSeeAll}><Text style={{ fontSize: 12.5, fontWeight: '700', color: '#8A8172' }}>See all</Text></TouchableOpacity> : null}
    </View>
  );

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={NAVY} /></View>;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={NAVY} />}
      showsVerticalScrollIndicator={false}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 10 }}>
        {CITIES.map(c => (
          <TouchableOpacity key={c} onPress={() => pick(c)}
            style={{ paddingHorizontal: 13, paddingVertical: 6, borderRadius: 99, backgroundColor: c === city ? '#E8E0D0' : 'rgba(0,0,0,0.05)' }}>
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: c === city ? '#0A0A0A' : 'rgba(11,30,61,0.55)' }}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <H title={'Marketplace ' + (city === 'All Zimbabwe' ? 'across Zimbabwe' : 'in ' + city)} onSeeAll={() => navigation.navigate('Market')} />
      {shownListings.length === 0 ? (
        <Text style={{ fontSize: 13, color: 'rgba(11,30,61,0.5)', paddingVertical: 10 }}>Nothing listed here yet. Be the first, list something on the Market.</Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {shownListings.map(l => (
            <TouchableOpacity key={l.id} activeOpacity={0.9} onPress={() => navigation.navigate('Market', { screen: 'ListingDetail', params: { listingId: l.id } })}
              style={{ width: '48.5%', marginBottom: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(11,30,61,0.08)', overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
              {listingImg(l) ? (
                <Image source={{ uri: listingImg(l) as string }} style={{ width: '100%', height: 120, backgroundColor: 'rgba(0,0,0,0.05)' }} resizeMode="cover" />
              ) : (
                <View style={{ width: '100%', height: 120, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.04)' }}>
                  <Feather name="shopping-bag" size={22} color="rgba(11,30,61,0.3)" />
                </View>
              )}
              <View style={{ padding: 9 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#0A0A0A' }}>{priceTxt(l)}</Text>
                <Text style={{ fontSize: 12.5, color: 'rgba(11,30,61,0.75)', marginTop: 2 }} numberOfLines={1}>{l.title}</Text>
                {l.location_city ? <Text style={{ fontSize: 11, color: 'rgba(11,30,61,0.45)', marginTop: 2 }} numberOfLines={1}>{l.location_city}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <H title={'Jobs ' + (city === 'All Zimbabwe' ? 'across Zimbabwe' : 'in ' + city)} onSeeAll={() => navigation.navigate('Jobs')} />
      {shownJobs.length === 0 ? (
        <Text style={{ fontSize: 13, color: 'rgba(11,30,61,0.5)', paddingVertical: 10 }}>No openings here right now. New roles land as employers post them.</Text>
      ) : (
        shownJobs.map(j => (
          <TouchableOpacity key={j.id} activeOpacity={0.9} onPress={() => navigation.navigate('Jobs', { screen: 'JobDetail', params: { job: j } })}
            style={{ marginBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(11,30,61,0.08)', padding: 12, backgroundColor: '#FFFFFF' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#0A0A0A' }} numberOfLines={1}>{j.title}</Text>
            <Text style={{ fontSize: 12.5, color: 'rgba(11,30,61,0.6)', marginTop: 3 }} numberOfLines={1}>
              {(j.company || j.company_name || 'Employer') + (j.location ? ' · ' + j.location : '')}
            </Text>
          </TouchableOpacity>
        ))
      )}

      {bizPosts.length > 0 ? (
        <View>
          <H title="From Zimbabwe businesses" />
          {bizPosts.map(r => (
            <TouchableOpacity key={r.post_id} activeOpacity={0.9} onPress={() => navigation.navigate('Post', { postId: r.post_id })}
              style={{ marginBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(11,30,61,0.08)', padding: 12, backgroundColor: '#FFFFFF', flexDirection: 'row', gap: 10 }}>
              {r.author_avatar ? (
                <Image source={{ uri: r.author_avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)' }} />
              ) : (
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{String(r.author_name ?? '?').charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#0A0A0A' }} numberOfLines={1}>{r.author_name}</Text>
                <Text style={{ fontSize: 12.5, color: 'rgba(11,30,61,0.7)', marginTop: 2 }} numberOfLines={2}>{r.content || r.article_title || 'View post'}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10 }}>
        <Feather name="map-pin" size={12} color="rgba(11,30,61,0.35)" />
        <Text style={{ fontSize: 11.5, color: 'rgba(11,30,61,0.35)', flex: 1 }}>Local shows Zimbabwe listings, jobs and business posts. City filters apply to listings and jobs.</Text>
      </View>
    </ScrollView>
  );
}