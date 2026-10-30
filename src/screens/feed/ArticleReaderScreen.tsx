import { themedSheet } from '../../theme/useTheme';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
/**
 * ArticleReaderScreen - Twitter long-form reading view.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, View, Text, ScrollView, TouchableOpacity, Image, Dimensions } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import { supabase , SUPABASE_URL } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { hydratePostMedia } from '../../services/contentMedia';
import { replaceContentMedia } from '../../../shared/contentMedia';
import ArticleBody from '../../components/ArticleBody';

const W = Dimensions.get('window').width;

export default function ArticleReaderScreen({ route, navigation }: any) {
  const source = useMemo(() => route.params?.article || {}, [route.params?.article]);
  const viewer = useAuthStore(state => state.profile?.id ?? null);
  const empty = useMemo(() => replaceContentMedia(source, SUPABASE_URL, new Map()), [source]);
  const [result, setResult] = useState<{ source: any; viewer: string | null; article: any; gallery: { url: string; width?: number; height?: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const a = result && result.source === source && result.viewer === viewer ? result.article : empty;
  const galleryImages = result && result.source === source && result.viewer === viewer ? result.gallery : [];
  useEffect(() => {
    let alive = true, generation = 0;
    const load = async () => {
      const request = ++generation;
      try {
        let images: { url: string; width?: number; height?: number }[] = [];
        if (source.postId) {
          const { data: art, error: articleError } = await supabase.from('articles').select('current_revision_id').eq('linked_post_id', source.postId).maybeSingle();
          if (articleError) throw articleError;
          if (art?.current_revision_id) {
            const { data: block, error: blockError } = await supabase.from('article_blocks').select('content').eq('revision_id', art.current_revision_id).eq('block_type', 'gallery').maybeSingle();
            if (blockError) throw blockError;
            if (Array.isArray(block?.content?.images)) images = block.content.images;
          }
        }
        const [hydrated] = await hydratePostMedia([{ ...source, id: source.postId, gallery: images }]);
        if (alive && generation === request) { setResult({ source, viewer, article: hydrated, gallery: hydrated.gallery }); setError(null); }
      } catch { if (alive && generation === request) { setResult(null); setError('The article media could not load. Tap to retry.'); } }
    };
    void load();
    const app = AppState.addEventListener('change', value => { if (value === 'active') void load(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 240000);
    return () => { alive = false; generation++; app.remove(); clearInterval(timer); };
  }, [source, viewer, retry]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.bar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color="#0A0A0A" />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE + 74 }}>
        {!!a.cover && <Image source={{ uri: a.cover }} style={s.cover} />}
        <View style={s.body}>
          <Text style={s.title}>{a.title}</Text>
          <View style={s.metaRow}>
            <Text style={s.meta}>{a.author || 'Member'}</Text>
            {!!a.readMinutes && <Text style={s.meta}>  ·  {a.readMinutes} min read</Text>}
          </View>
          {error ? <TouchableOpacity onPress={() => setRetry(n => n + 1)}><Text>{error}</Text></TouchableOpacity> : null}
          <ArticleBody text={a.body || ''} />
          {galleryImages.length > 0 && (
            <View style={s.galleryGrid}>
              {galleryImages.map((img: { url: string; width?: number; height?: number }, i: number) => (
                <Image
                  key={img.url + i}
                  source={{ uri: img.url }}
                  style={galleryImages.length === 1 ? s.galleryFull : s.galleryHalf}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  bar: { paddingHorizontal: 12, paddingVertical: 8 },
  cover: { width: W, height: W * 0.52, backgroundColor: '#EFEFF4' },
  body: { paddingHorizontal: 20, paddingTop: 18 },
  title: { fontSize: 30, fontWeight: '800', color: '#0A0A0A', letterSpacing: -0.8, lineHeight: 36 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 20 },
  meta: { fontSize: 14, color: '#6B7280' },
  text: { fontSize: 17.5, lineHeight: 28, color: '#111827' },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  galleryFull: { width: '100%', height: 260, borderRadius: 14, backgroundColor: '#EFEFF4' },
  galleryHalf: { width: '48%', height: 150, borderRadius: 14, backgroundColor: '#EFEFF4' },
}));