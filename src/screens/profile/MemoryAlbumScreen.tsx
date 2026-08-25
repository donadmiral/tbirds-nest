import VideoThumb from '../../components/VideoThumb';
/**
 * MemoryAlbumScreen — the memory book.
 * Closed: a real album cover (stitched border, corner flowers, gold clasp
 * with a pearl heart) in the album's palette. Tap to open.
 * Open: a flip book — one taped polaroid memory per page, page-turn
 * animation on arrows, edge taps and swipes, with an n / total pager.
 * Owner: add from own stories, edit captions, remove pages, settings.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, FlatList,
  ActivityIndicator, Alert, Dimensions, StatusBar, ScrollView, Animated,
  Easing, PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Ellipse, Circle } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { supabase } from '../../services/supabase';
import { COVER_COLORS } from '../../components/MemoryAlbumCard';

const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;
const PAGE_CREAM = '#FBF6EC';
const TAPE = 'rgba(230,214,178,0.78)';

const AUDIENCES = [
  { key: 'profile', label: 'Everyone who can view my profile' },
  { key: 'followers', label: 'Followers only' },
  { key: 'custom', label: 'Only people I choose' },
  { key: 'only_me', label: 'Only me' },
];

function Flower({ size, petal, heart }: { size: number; petal: string; heart: string }) {
  const cx = size / 2, cy = size / 2, r = size * 0.19;
  const petals = [0, 72, 144, 216, 288];
  return (
    <Svg width={size} height={size}>
      {petals.map(a => {
        const rad = (a * Math.PI) / 180;
        return (
          <Ellipse key={a}
            cx={cx + Math.cos(rad) * size * 0.21}
            cy={cy + Math.sin(rad) * size * 0.21}
            rx={size * 0.17} ry={size * 0.11}
            rotation={a} origin={`${cx + Math.cos(rad) * size * 0.21}, ${cy + Math.sin(rad) * size * 0.21}`}
            fill={petal} opacity={0.9}
          />
        );
      })}
      <Circle cx={cx} cy={cy} r={r * 0.55} fill={heart} opacity={0.95} />
    </Svg>
  );
}

export default function MemoryAlbumScreen({ route, navigation }: any) {
  const ownerId: string = route.params?.ownerId;
  const albumIdParam: string | null = route.params?.albumId ?? null;
  const [bookId, setBookId] = useState<string | null>(albumIdParam);
  const insets = useSafeAreaInsets();
  const [album, setAlbum] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState(false);
  const [idx, setIdx] = useState(0);
  const [picker, setPicker] = useState(false);
  const [myStories, setMyStories] = useState<any[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const [title, setTitle] = useState('');
  const [color, setColor] = useState('blush');
  const [aud, setAud] = useState('profile');
  const [captionFor, setCaptionFor] = useState<any | null>(null);
  const [captionText, setCaptionText] = useState('');
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [likedPages, setLikedPages] = useState<Set<string>>(new Set());

  const coverAnim = useRef(new Animated.Value(0)).current;
  const flipAnim = useRef(new Animated.Value(0)).current;
  const flipping = useRef(false);
  const idxRef = useRef(0);
  useEffect(() => { idxRef.current = idx; }, [idx]);

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      const { data, error } = albumIdParam
        ? await supabase.rpc('get_memory_book', { p_album: albumIdParam })
        : await supabase.rpc('get_memory_album', { p_owner: ownerId });
      if (!error) {
        setAlbum(data ?? null);
        if (data) {
          setTitle(data.title || 'Memories'); setColor(data.cover_color || 'blush'); setAud(data.audience || 'profile');
          if (data.id) setBookId(data.id);
        }
      }
    } finally { setLoading(false); }
  }, [ownerId]);

  useEffect(() => { load(); }, [load]);

  const c = COVER_COLORS[album?.cover_color] ?? COVER_COLORS.blush;
  const pages: any[] = useMemo(
    () => [...(album?.pages ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [album],
  );

  useEffect(() => { if (idx > 0 && idx >= pages.length) setIdx(Math.max(0, pages.length - 1)); }, [pages.length, idx]);

  const openBook = useCallback(() => {
    Animated.timing(coverAnim, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => setOpened(true));
  }, [coverAnim]);

  const closeBook = useCallback(() => {
    setOpened(false);
    Animated.timing(coverAnim, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [coverAnim]);

  const flipTo = useCallback((dir: 1 | -1) => {
    const cur = idxRef.current;
    const next = cur + dir;
    if (flipping.current || next < 0 || next >= Math.max(pages.length, 1)) return;
    flipping.current = true;
    Animated.timing(flipAnim, { toValue: dir, duration: 190, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      setIdx(next);
      flipAnim.setValue(-dir as any);
      Animated.timing(flipAnim, { toValue: 0, duration: 210, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => { flipping.current = false; });
    });
  }, [pages.length, flipAnim]);

  const swipe = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
    onPanResponderRelease: (_e, g) => {
      if (g.dx <= -30) flipTo(1);
      else if (g.dx >= 30) flipTo(-1);
    },
  }), [flipTo]);

  const openPicker = useCallback(async () => {
    setChosen(new Set());
    setPicker(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    const inAlbum = new Set(pages.map(p => p.media_url).filter(Boolean));
    const { data } = await supabase.from('stories')
      .select('id, media_url, media_type, thumbnail_url, caption, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(120);
    setMyStories((data ?? []).map((s: any) => ({ ...s, _in: inAlbum.has(s.media_url) })));
  }, [pages]);

  const addChosen = useCallback(async () => {
    if (chosen.size === 0 || adding) return;
    setAdding(true);
    try {
      for (const id of chosen) {
        try { await supabase.rpc('add_memory_page', { p_story_id: id, p_album_id: bookId }); } catch {}
      }
      setPicker(false);
      await load();
    } finally { setAdding(false); }
  }, [chosen, adding, load]);

  const pageMenu = useCallback(() => {
    const p = pages[idxRef.current];
    if (!album?.is_owner || !p) { return; }
    Alert.alert('This memory', p.caption || '', [
      { text: 'Edit caption', onPress: () => { setCaptionFor(p); setCaptionText(p.caption || ''); } },
      { text: 'Remove from album', style: 'destructive', onPress: async () => {
        await supabase.from('memory_pages').delete().eq('id', p.id);
        load();
      } },
      { text: 'Album settings', onPress: () => setSettings(true) },
      ...(album?.is_default === false ? [{ text: 'Delete this book', style: 'destructive' as const, onPress: () => {
        Alert.alert('Delete this book?', 'Its memories leave the book too. Stories are not deleted.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async () => {
            try { await supabase.rpc('delete_memory_book', { p_album: bookId }); } catch {}
            navigation.goBack();
          } },
        ]);
      } }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [album, pages, load]);

  const saveCaption = useCallback(async () => {
    if (!captionFor) return;
    await supabase.from('memory_pages').update({ caption: captionText.trim() || null }).eq('id', captionFor.id);
    setCaptionFor(null);
    load();
  }, [captionFor, captionText, load]);

  const saveSettings = useCallback(async () => {
    if (bookId) {
      await supabase.rpc('update_memory_book', {
        p_album: bookId, p_title: title.trim() || 'Memories', p_cover_color: color, p_audience: aud,
      });
    } else {
      await supabase.rpc('upsert_memory_album', {
        p_title: title.trim() || 'Memories', p_cover_color: color, p_audience: aud,
      });
    }
    setSettings(false);
    load();
  }, [title, color, aud, load]);

  const fmtDate = (d?: string | null) => {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
  };

  if (loading) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#0B1E3D" /></View>
      </SafeAreaView>
    );
  }

  if (!album || (!album.is_owner && (!album.can_view || album.count === 0))) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
        <View style={st.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="chevron-left" size={26} color="#0B1E3D" />
          </TouchableOpacity>
          <Text style={st.topTitle}>Memory album</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <Feather name="lock" size={22} color="#9AA6B8" />
          <Text style={{ marginTop: 10, fontSize: 13.5, color: '#5B6B84', textAlign: 'center' }}>This album is private.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const bookW = Math.min(SW - 72, 330);
  const bookH = Math.min(bookW * 1.28, SH * 0.56);
  const page = pages[Math.min(idx, Math.max(pages.length - 1, 0))];
  const rotY = flipAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['70deg', '0deg', '-70deg'] });
  const flipOpacity = flipAnim.interpolate({ inputRange: [-1, -0.5, 0, 0.5, 1], outputRange: [0, 0.65, 1, 0.65, 0] });
  const coverScale = coverAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const coverFade = coverAnim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0, 0] });

  return (
    <View style={[st.safe, { paddingTop: Math.max(insets.top, 12), backgroundColor: '#F5EFE4' }]}>
      <StatusBar barStyle="dark-content" />
      <View style={st.topBar}>
        <TouchableOpacity onPress={() => (opened ? closeBook() : navigation.goBack())} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color="#0B1E3D" />
        </TouchableOpacity>
        <Text style={st.topTitle}>{opened ? album.title : 'Memory album'}</Text>
        {opened && album.is_owner ? (
          <TouchableOpacity onPress={pageMenu} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="more-horizontal" size={22} color="#0B1E3D" />
          </TouchableOpacity>
        ) : !opened && album.is_owner ? (
          <TouchableOpacity onPress={() => setSettings(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="settings" size={19} color="#0B1E3D" />
          </TouchableOpacity>
        ) : <View style={{ width: 22 }} />}
      </View>

      {!opened ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={{ transform: [{ scale: coverScale }], opacity: coverFade }}>
            <TouchableOpacity activeOpacity={0.92} onPress={openBook}>
              <View style={[st.book, { width: bookW, height: bookH, backgroundColor: c.spine }]}>
                <View style={[st.bookInner, { backgroundColor: c.cover, borderColor: c.text + '44' }]}>
                  <View style={{ position: 'absolute', top: 10, left: 10 }}><Flower size={44} petal={c.spine} heart={c.text} /></View>
                  <View style={{ position: 'absolute', top: 10, right: 10, transform: [{ scaleX: -1 }] }}><Flower size={36} petal={c.spine} heart={c.text} /></View>
                  <View style={{ position: 'absolute', bottom: 12, left: 12 }}><Flower size={40} petal={c.spine} heart={c.text} /></View>
                  <View style={{ position: 'absolute', bottom: 12, right: 12, transform: [{ scaleX: -1 }] }}><Flower size={46} petal={c.spine} heart={c.text} /></View>
                  <Text style={[st.coverTitle, { color: c.text }]}>{album.title}</Text>
                  <Feather name="heart" size={15} color={c.text} style={{ marginTop: 10, opacity: 0.9 }} />
                  <Text style={[st.coverCount, { color: c.text }]}>{album.count} {album.count === 1 ? 'memory' : 'memories'}</Text>
                </View>
                <View style={st.claspBase}>
                  <View style={st.claspHeart}><Feather name="heart" size={11} color="#F3EDE2" /></View>
                </View>
              </View>
            </TouchableOpacity>
          </Animated.View>
          <Text style={st.tapHint}>Tap the book to open it</Text>
          {album.is_owner ? (
            <TouchableOpacity onPress={openPicker} activeOpacity={0.9} style={[st.fab, { position: 'relative', bottom: 0, marginTop: 22 }]}>
              <Feather name="plus" size={18} color="#FFFFFF" />
              <Text style={st.fabTxt}>Add memories</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center' }} {...swipe.panHandlers}>
          <View style={[st.openBook, { borderColor: c.spine }]}>
            <View style={st.pagePaper}>
              <View style={st.rings}>
                {[0, 1, 2, 3].map(i => <View key={i} style={st.ring} />)}
              </View>
              {pages.length === 0 ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 }}>
                  <Text style={st.emptyTxt}>{album.is_owner ? 'This book is empty.\nAdd your first memory.' : 'No memories yet.'}</Text>
                  {album.is_owner ? (
                    <TouchableOpacity onPress={openPicker} style={[st.fab, { position: 'relative', bottom: 0, marginTop: 18 }]}>
                      <Feather name="plus" size={16} color="#FFF" /><Text style={st.fabTxt}>Add memories</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <Animated.View style={{ flex: 1, opacity: flipOpacity, transform: [{ perspective: 1200 }, { rotateY: rotY }] }}>
                  <View style={[st.polaroid, { transform: [{ rotate: idx % 2 === 0 ? '-1.6deg' : '1.4deg' }] }]}>
                    <View style={st.tapeTop} />
                    <View style={st.polImgWrap}>
                      {(() => { const stks = Array.isArray(page?.stickers) ? page.stickers : []; const pk = stks.find((k: any) => k && k.kind === 'post'); if (pk) return (
                        <View style={{ flex: 1, backgroundColor: '#0E1B33', borderRadius: 6, padding: 12 }}>
                          <Text style={{ color: '#C9BFB0', fontSize: 11.5, fontWeight: '700', marginBottom: 6 }} numberOfLines={1}>{pk.postAuthorName || 'Shared post'}</Text>
                          {pk.postText ? <Text style={{ color: '#F5F0EB', fontSize: 13.5, lineHeight: 19 }} numberOfLines={4}>{pk.postText}</Text> : null}
                          {pk.postMediaUrl ? (pk.postMediaType === 'video' ? (
                            <TouchableOpacity activeOpacity={0.9} onPress={() => setPlayingUrl(pk.postMediaUrl)} style={{ marginTop: 8, flex: 1, minHeight: 150, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}><VideoThumb uri={pk.postMediaUrl} fill chip={false} /><View style={{ position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><Feather name="play" size={19} color="#FFFFFF" /></View></TouchableOpacity>
                          ) : (
                            <ExpoImage source={{ uri: pk.postMediaUrl }} style={{ marginTop: 8, flex: 1, minHeight: 150, borderRadius: 8 }} contentFit="cover" />
                          )) : null}
                          <Text style={{ color: '#8FA0B8', fontSize: 10.5, marginTop: 8 }}>Shared post</Text>
                        </View>
                      ); if (page?.media_type === 'video') return (<View style={{ flex: 1 }}><PageVideo url={page.media_url} /><TouchableOpacity onPress={() => setPlayingUrl(page.media_url)} style={{ position: 'absolute', right: 8, bottom: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><Feather name="maximize-2" size={15} color="#FFFFFF" /></TouchableOpacity></View>); if (page?.media_url || page?.thumbnail_url) return (
                        <ExpoImage source={{ uri: page.thumbnail_url || page.media_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={140} />
                      ); return (
                        <View style={{ flex: 1, backgroundColor: '#0B1E3D', borderRadius: 6, alignItems: 'center', justifyContent: 'center', padding: 14 }}>
                          <Text style={{ color: '#F5F0EB', fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 22 }} numberOfLines={6}>{page?.story_caption || page?.caption || 'A moment'}</Text>
                        </View>
                      ); })()}
                    </View>
                    <Text numberOfLines={2} style={st.handCaption}>{page?.caption || ' '}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                      <Text style={st.handDate}>{fmtDate(page?.taken_at)}</Text>
                      <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => { if (!page?.story_id) return; setLikedPages(prev => { const n = new Set(prev); if (n.has(page.story_id)) { n.delete(page.story_id); } else { n.add(page.story_id); } return n; }); void supabase.rpc('toggle_story_reaction', { p_story_id: page.story_id, p_emoji: '\u2764\uFE0F' }); }}><Feather name="heart" size={13} color={likedPages.has(page?.story_id) ? '#E0245E' : '#D4537E'} /></TouchableOpacity>
                    </View>
                  </View>
                </Animated.View>
              )}
              <TouchableOpacity style={st.edgeL} onPress={() => flipTo(-1)} />
              <TouchableOpacity style={st.edgeR} onPress={() => flipTo(1)} />
            </View>
          </View>

          {pages.length > 0 ? (
            <View style={st.pagerRow}>
              <TouchableOpacity onPress={() => flipTo(-1)} disabled={idx === 0} style={[st.pagerBtn, idx === 0 && { opacity: 0.35 }]}>
                <Feather name="chevron-left" size={17} color="#0B1E3D" />
              </TouchableOpacity>
              <View style={st.pagerPill}><Text style={st.pagerTxt}>{idx + 1} / {pages.length}</Text></View>
              <TouchableOpacity onPress={() => flipTo(1)} disabled={idx >= pages.length - 1} style={[st.pagerBtn, idx >= pages.length - 1 && { opacity: 0.35 }]}>
                <Feather name="chevron-right" size={17} color="#0B1E3D" />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      )}

      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <View style={[st.safe, { paddingTop: Math.max(insets.top, 12) }]}>
          <View style={st.topBar}>
            <TouchableOpacity onPress={() => setPicker(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={22} color="#0B1E3D" />
            </TouchableOpacity>
            <Text style={st.topTitle}>Add from your stories</Text>
            <TouchableOpacity disabled={chosen.size === 0 || adding} onPress={addChosen}>
              {adding ? <ActivityIndicator size={16} color="#0B1E3D" /> : (
                <Text style={{ fontSize: 14, fontWeight: '800', color: chosen.size === 0 ? '#C7CEDA' : '#0B1E3D' }}>Add{chosen.size > 0 ? ' ' + chosen.size : ''}</Text>
              )}
            </TouchableOpacity>
          </View>
          <FlatList
            data={myStories}
            keyExtractor={(s: any) => s.id}
            numColumns={3}
            contentContainerStyle={{ padding: 10, gap: 6, paddingBottom: 40 }}
            columnWrapperStyle={{ gap: 6 }}
            renderItem={({ item }: any) => {
              const on = chosen.has(item.id);
              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={item._in}
                  onPress={() => setChosen(prev => { const n = new Set(prev); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; })}
                  style={{ width: (SW - 20 - 12) / 3, aspectRatio: 0.75, borderRadius: 8, overflow: 'hidden', backgroundColor: '#0B1E3D', opacity: item._in ? 0.35 : 1 }}
                >
                  {(item.thumbnail_url || item.media_url) ? (
                    <ExpoImage source={{ uri: item.thumbnail_url || item.media_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  ) : null}
                  {item.media_type === 'video' ? (
                    <View style={st.vidBadge}><Feather name="video" size={10} color="#FFF" /></View>
                  ) : null}
                  {item._in ? (
                    <View style={st.inChip}><Text style={st.inChipTxt}>In album</Text></View>
                  ) : on ? (
                    <View style={st.checkWrap}><Feather name="check" size={13} color="#FFFFFF" /></View>
                  ) : null}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 50, fontSize: 13, color: '#5B6B84' }}>No stories yet. Post a story first.</Text>}
          />
        </View>
      </Modal>

      <Modal visible={settings} transparent animationType="fade" onRequestClose={() => setSettings(false)}>
        <View style={st.sheetWrap}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>Album settings</Text>
            <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <TextInput value={title} onChangeText={setTitle} placeholder="Memories" placeholderTextColor="#9AA6B8" style={st.input} maxLength={40} />
              <Text style={st.lbl}>Cover</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {Object.keys(COVER_COLORS).map(k => (
                  <TouchableOpacity key={k} onPress={() => setColor(k)}
                    style={{ width: 30, height: 38, borderRadius: 5, backgroundColor: COVER_COLORS[k].cover, borderWidth: color === k ? 2.5 : 1, borderColor: color === k ? '#0B1E3D' : 'rgba(11,30,61,0.15)' }} />
                ))}
              </View>
              <Text style={st.lbl}>Who can open it</Text>
              {AUDIENCES.map(a => (
                <TouchableOpacity key={a.key} onPress={() => setAud(a.key)} style={[st.audRow, aud === a.key && st.audRowOn]}>
                  <Text style={[st.audTxt, aud === a.key && { fontWeight: '800' }]}>{a.label}</Text>
                  {aud === a.key ? <Feather name="check" size={15} color="#0B1E3D" /> : null}
                </TouchableOpacity>
              ))}
              {aud === 'custom' ? <Text style={st.hint}>Choose the people on the web album page for now.</Text> : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 14 }}>
              <TouchableOpacity onPress={() => setSettings(false)}><Text style={{ color: '#5B6B84', fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveSettings}><Text style={{ color: '#0B1E3D', fontWeight: '800' }}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {playingUrl ? (
        <MemoryVideo url={playingUrl} topInset={Math.max(insets.top, 12)} onClose={() => setPlayingUrl(null)} />
      ) : null}

      <Modal visible={!!captionFor} transparent animationType="fade" onRequestClose={() => setCaptionFor(null)}>
        <View style={st.sheetWrap}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>Caption</Text>
            <TextInput value={captionText} onChangeText={setCaptionText} placeholder="Say something about this memory" placeholderTextColor="#9AA6B8" style={[st.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline maxLength={140} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 8 }}>
              <TouchableOpacity onPress={() => setCaptionFor(null)}><Text style={{ color: '#5B6B84', fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveCaption}><Text style={{ color: '#0B1E3D', fontWeight: '800' }}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MemoryVideo({ url, topInset, onClose }: { url: string; topInset: number; onClose: () => void }) {
  const player = useVideoPlayer(url, p => { p.loop = true; p.play(); });
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
        <TouchableOpacity onPress={onClose} style={{ position: 'absolute', top: topInset + 6, left: 14, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="x" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  topTitle: { fontSize: 15.5, fontWeight: '800', color: '#0B1E3D' },
  book: { borderRadius: 16, padding: 9, paddingLeft: 15, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  bookInner: { flex: 1, borderRadius: 10, borderWidth: 1.4, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  coverTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: 0.4, lineHeight: 31 },
  coverCount: { fontSize: 11.5, fontWeight: '700', marginTop: 12, opacity: 0.75 },
  claspBase: { position: 'absolute', right: -13, top: '44%', width: 42, height: 46, borderTopLeftRadius: 10, borderBottomLeftRadius: 10, borderTopRightRadius: 14, borderBottomRightRadius: 14, backgroundColor: '#E4D2A6', borderWidth: 1, borderColor: '#CBB27C', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 2, height: 2 }, elevation: 5 },
  claspHeart: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#D9C084', borderWidth: 1, borderColor: '#C4A96B', alignItems: 'center', justifyContent: 'center' },
  tapHint: { marginTop: 16, fontSize: 12, color: '#8b7f68', fontWeight: '600' },
  openBook: { marginTop: 8, width: SW - 28, height: SH * 0.66, borderRadius: 18, borderWidth: 8, backgroundColor: PAGE_CREAM, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 7 },
  pagePaper: { flex: 1, backgroundColor: PAGE_CREAM, paddingLeft: 34, paddingRight: 18, paddingVertical: 18 },
  rings: { position: 'absolute', left: 8, top: 0, bottom: 0, width: 20, alignItems: 'center', justifyContent: 'space-evenly' },
  ring: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: '#AAB0BA', backgroundColor: 'transparent' },
  polaroid: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 6, padding: 12, paddingBottom: 14, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.08)' },
  tapeTop: { position: 'absolute', top: -9, alignSelf: 'center', width: 84, height: 20, backgroundColor: TAPE, transform: [{ rotate: '-3deg' }], borderRadius: 2, zIndex: 3 },
  polImgWrap: { flex: 1, borderRadius: 4, overflow: 'hidden', backgroundColor: '#0B1E3D' },
  playChip: { position: 'absolute', alignSelf: 'center', top: '44%', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  handCaption: { fontSize: 15, fontStyle: 'italic', fontWeight: '600', color: '#5a5140', marginTop: 12, minHeight: 20 },
  handDate: { fontSize: 11.5, fontStyle: 'italic', color: '#8b7f68' },
  edgeL: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 46 },
  edgeR: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 46 },
  pagerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  pagerBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  pagerPill: { backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  pagerTxt: { fontSize: 13, fontWeight: '800', color: '#0B1E3D' },
  emptyTxt: { fontSize: 13.5, color: '#8b7f68', textAlign: 'center', lineHeight: 20 },
  fab: { position: 'absolute', bottom: 26, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#0B1E3D', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  fabTxt: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' },
  vidBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2.5 },
  checkWrap: { position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#1D7A38', alignItems: 'center', justifyContent: 'center' },
  inChip: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2 },
  inChipTxt: { color: '#FFF', fontSize: 9.5, fontWeight: '700' },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(11,30,61,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },
  sheet: { alignSelf: 'stretch', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, maxHeight: '82%' },
  sheetTitle: { fontSize: 15.5, fontWeight: '800', color: '#0B1E3D', marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#E1E6EE', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#0B1E3D', marginBottom: 12 },
  lbl: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: '#5B6B84', marginBottom: 8, marginTop: 2 },
  audRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E7EAF0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 7 },
  audRowOn: { borderColor: '#0B1E3D', backgroundColor: 'rgba(11,30,61,0.03)' },
  audTxt: { fontSize: 13, color: '#0B1E3D', flex: 1, marginRight: 8 },
  hint: { fontSize: 11.5, color: '#5B6B84', marginBottom: 4 },
});

function PageVideo({ url }: { url: string }) {
  const pv = useVideoPlayer(url, pp => { pp.loop = true; pp.muted = true; try { pp.play(); } catch {} });
  return <VideoView player={pv} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls={false} />;
}