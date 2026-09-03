import { TAB_BAR_CLEARANCE } from '../../constants/layout';
/**
 * ArticleReaderScreen - Twitter long-form reading view.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import ArticleBody from '../../components/ArticleBody';

const W = Dimensions.get('window').width;

export default function ArticleReaderScreen({ route, navigation }: any) {
  const a = route.params?.article || {};
  const [galleryImages, setGalleryImages] = useState<{ url: string; width?: number; height?: number }[]>([]);

  useEffect(() => {
    if (!a.postId) return;
    let dead = false;
    supabase.from('articles').select('current_revision_id').eq('linked_post_id', a.postId).maybeSingle()
      .then(({ data: art }: { data: { current_revision_id: string } | null }) => {
        if (dead || !art?.current_revision_id) return;
        supabase.from('article_blocks').select('content').eq('revision_id', art.current_revision_id).eq('block_type', 'gallery').maybeSingle()
          .then(({ data: blk }: { data: { content: unknown } | null }) => {
            if (dead) return;
            const imgs = (blk?.content as { images?: unknown })?.images;
            if (Array.isArray(imgs)) setGalleryImages(imgs as { url: string; width?: number; height?: number }[]);
          });
      });
    return () => { dead = true; };
  }, [a.postId]);

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
          <ArticleBody text={a.body} />
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
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
});