import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { appleMusic } from '../services/appleMusic';
import { useTheme } from '../theme/useTheme';
import { parseAppleMusicLink, type AppleMusicTrack } from '../../shared/appleMusic';
import { useSafeAreaInsets } from './SafeArea';

export function AppleMusicPicker({ onSelect }: { onSelect: (track: AppleMusicTrack) => void }) {
  const { t } = useTheme();
  const [query, setQuery] = useState('');
  const [storefront, setStorefront] = useState('zw');
  const [tracks, setTracks] = useState<AppleMusicTrack[]>([]);
  const [offset, setOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => () => { generation.current += 1; }, []);
  const reset = () => { generation.current += 1; busy.current = false; setLoading(false); setTracks([]); setOffset(null); setSearched(false); setError(''); };
  const parsed = parseAppleMusicLink(query);
  const search = async (more = false) => {
    if (busy.current || (!parsed && query.trim().length < 2)) return;
    busy.current = true; setLoading(true); setError('');
    const mine = ++generation.current;
    try {
      const result = parsed ? await appleMusic.track(parsed.id, parsed.storefront) : await appleMusic.search(query.trim(), storefront.toLowerCase(), more ? offset ?? 0 : 0);
      if (mine !== generation.current) return;
      setTracks(previous => [...new Map([...(more ? previous : []), ...result.tracks].map(track => [track.id, track])).values()]);
      setOffset(result.nextOffset); setSearched(true);
    } catch (e) { if (mine === generation.current) setError(e instanceof Error ? e.message : 'Could not search Apple Music.'); }
    finally { if (mine === generation.current) { busy.current = false; setLoading(false); } }
  };
  const button = { minHeight: 44, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10, backgroundColor: t.brand.base, alignItems: 'center' as const, justifyContent: 'center' as const };
  return <View style={{ gap: 12 }}>
    <Text style={{ color: t.ink.secondary }}>Share a song for people to open in Apple Music. The link does not add audio to your photo or video.</Text>
    <TextInput accessibilityLabel="Song, artist or Apple Music song link" value={query} onChangeText={value => { reset(); setQuery(value); }} onSubmitEditing={() => search()} autoCapitalize="none" autoCorrect={false} placeholder="Song, artist or Apple Music link" placeholderTextColor={t.ink.muted} returnKeyType="search" style={{ minHeight: 46, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 10, padding: 12, color: t.ink.primary }} />
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
      <Text style={{ color: t.ink.secondary }}>Catalog country</Text>
      <TextInput accessibilityLabel="Two-letter Apple Music catalog country" value={storefront} maxLength={2} autoCapitalize="none" onChangeText={value => { reset(); setStorefront(value.replace(/[^a-z]/gi, '').toLowerCase()); }} style={{ minWidth: 54, minHeight: 44, color: t.ink.primary, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 8, padding: 10 }} />
      <TouchableOpacity accessibilityRole="button" onPress={() => search()} disabled={loading || (!parsed && (query.trim().length < 2 || storefront.length !== 2))} style={[button, { flex: 1, opacity: loading ? 0.6 : 1 }]}><Text style={{ color: t.ink.inverse, fontWeight: '700' }}>{loading ? 'Searching…' : 'Search'}</Text></TouchableOpacity>
    </View>
    {error ? <Text accessibilityRole="alert" style={{ color: t.status.danger }}>{error}</Text> : null}
    {parsed ? <TouchableOpacity accessibilityRole="button" onPress={() => onSelect({ ...parsed, title: 'Apple Music song', artist: '', album: '', artworkUrl: null, explicit: false })} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: t.status.link }}>Share this song link</Text></TouchableOpacity> : null}
    {loading && !tracks.length ? <ActivityIndicator color={t.brand.base} /> : null}
    {searched && !tracks.length && !loading ? <Text style={{ color: t.ink.secondary }}>No songs found. Try another search or catalog country.</Text> : null}
    <FlatList keyboardShouldPersistTaps="handled" data={tracks} keyExtractor={item => item.id} style={{ maxHeight: 280 }} renderItem={({ item }) => <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: t.surface.hairline }}>
      {item.artworkUrl ? <Image source={{ uri: item.artworkUrl }} accessibilityIgnoresInvertColors style={{ width: 48, height: 48, borderRadius: 7 }} /> : null}
      <View style={{ flex: 1 }}><Text numberOfLines={2} style={{ color: t.ink.primary, fontWeight: '600' }}>{item.title}{item.explicit ? ' · Explicit' : ''}</Text><Text numberOfLines={1} style={{ color: t.ink.secondary }}>{item.artist}</Text><TouchableOpacity accessibilityRole="link" accessibilityLabel={`Open ${item.title} in Apple Music`} style={{ minHeight: 36, justifyContent: 'center' }} onPress={() => { Linking.openURL(item.url).catch(() => setError('Could not open Apple Music. Try again.')); }}><Text style={{ color: t.status.link }}>Open in Apple Music</Text></TouchableOpacity></View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Share ${item.title}`} onPress={() => onSelect(item)} style={button}><Text style={{ color: t.ink.inverse }}>Share</Text></TouchableOpacity>
    </View>} />
    {offset !== null ? <TouchableOpacity accessibilityRole="button" onPress={() => search(true)} disabled={loading} style={button}><Text style={{ color: t.ink.inverse }}>{loading ? 'Loading…' : 'More songs'}</Text></TouchableOpacity> : null}
  </View>;
}

export default function AppleMusicSheet({ visible, onClose, onSelect }: { visible: boolean; onClose: () => void; onSelect: (track: AppleMusicTrack) => void }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: t.surface.scrim }}>
      <View accessibilityViewIsModal style={{ backgroundColor: t.surface.canvas, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: Math.max(insets.bottom, 18) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><Text style={{ color: t.ink.primary, fontSize: 18, fontWeight: '700' }}>Apple Music</Text><TouchableOpacity accessibilityRole="button" onPress={onClose} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}><Text style={{ color: t.status.link }}>Close</Text></TouchableOpacity></View>
        {visible ? <AppleMusicPicker onSelect={track => { onSelect(track); onClose(); }} /> : null}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
