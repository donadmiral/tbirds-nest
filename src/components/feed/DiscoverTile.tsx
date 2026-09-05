// src/components/feed/DiscoverTile.tsx
// The phone Discover tile, twin of web/components/DiscoverTile.tsx. A discovery
// surface wants density: many things visible at once, media leading, text only
// where it is the point. One tile handles every kind a post can be: photo and
// video lead with the frame, an article leads with its title, a shared link
// keeps its preview, and a text post becomes a quote card.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import VerifiedBadge from '../VerifiedBadge';
import VideoThumb from '../VideoThumb';
import { light } from '../../constants/tokens';

type Media = { url: string; media_type: 'image' | 'video'; edit?: any };
export type TilePost = {
  id: string; user_id: string; content?: string | null; article_title?: string | null;
  media?: Media[]; link?: { url?: string; domain?: string | null; title?: string | null; image_url?: string | null } | null;
};
type Author = { full_name?: string | null; username?: string | null; avatar_url?: string | null } | null | undefined;

export default function DiscoverTile({ post, author, width, onPress }: { post: TilePost; author: Author; width: number; onPress: () => void }) {
  const media = post.media ?? [];
  const first = media[0] ?? null;
  const isVideo = first?.media_type === 'video';
  const text = (post.content || '').trim();
  const link = post.link;

  const byline = (
    <View style={s.byline}>
      {author?.avatar_url
        ? <ExpoImage source={{ uri: author.avatar_url }} style={s.avatar} contentFit="cover" cachePolicy="memory-disk" />
        : <View style={[s.avatar, s.avatarEmpty]} />}
      <Text style={s.name} numberOfLines={1}>{author?.full_name || author?.username || 'Member'}</Text>
      <VerifiedBadge userId={post.user_id} size={11} />
    </View>
  );

  if (first) {
    const cover = isVideo ? ((first as any)?.edit?.coverUrl || null) : first.url;
    return (
      <TouchableOpacity style={[s.tile, { width }]} activeOpacity={0.85} onPress={onPress}>
        <View style={[s.frame, { height: width }]}>
          {cover
            ? <ExpoImage source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
            : isVideo
              ? <VideoThumb uri={first.url} fill chip={false} />
              : <View style={[StyleSheet.absoluteFill, s.frameEmpty]}><Feather name="image" size={22} color={light.ink.muted} /></View>}
          {isVideo ? <View style={s.play}><Feather name="play" size={12} color="#FFF" /></View> : null}
          {media.length > 1 ? <View style={s.count}><Text style={s.countTxt}>1/{media.length}</Text></View> : null}
        </View>
        {text ? <Text style={s.caption} numberOfLines={2}>{text}</Text> : null}
        {byline}
      </TouchableOpacity>
    );
  }

  if (post.article_title) {
    return (
      <TouchableOpacity style={[s.tile, { width, justifyContent: 'space-between' }]} activeOpacity={0.85} onPress={onPress}>
        <View style={s.pad}>
          <View style={s.kindRow}><Feather name="file-text" size={11} color={light.brand.base} /><Text style={s.kind}>Article</Text></View>
          <Text style={s.articleTitle} numberOfLines={3}>{post.article_title}</Text>
          {text ? <Text style={s.articleBody} numberOfLines={3}>{text}</Text> : null}
        </View>
        {byline}
      </TouchableOpacity>
    );
  }

  if (link?.image_url) {
    return (
      <TouchableOpacity style={[s.tile, { width }]} activeOpacity={0.85} onPress={onPress}>
        <View style={[s.frame, { height: Math.round(width * 0.625) }]}>
          <ExpoImage source={{ uri: link.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        </View>
        <View style={s.pad}>
          <View style={s.kindRow}><Feather name="link" size={11} color={light.ink.muted} /><Text style={[s.kind, { color: light.ink.muted }]} numberOfLines={1}>{link.domain || ''}</Text></View>
          <Text style={s.linkTitle} numberOfLines={2}>{link.title || text}</Text>
        </View>
        {byline}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={[s.tile, { width, justifyContent: 'space-between' }]} activeOpacity={0.85} onPress={onPress}>
      <View style={s.pad}><Text style={s.quote} numberOfLines={6}>{text}</Text></View>
      {byline}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  tile: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.12)', backgroundColor: '#FFFFFF', overflow: 'hidden' },
  frame: { width: '100%', backgroundColor: light.surface.sunken, overflow: 'hidden' },
  frameEmpty: { alignItems: 'center', justifyContent: 'center' },
  play: { position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  count: { position: 'absolute', top: 8, left: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 7, paddingVertical: 2 },
  countTxt: { fontSize: 10.5, fontWeight: '600', color: '#FFFFFF' },
  caption: { fontSize: 13, lineHeight: 17, color: 'rgba(11,30,61,0.8)', paddingHorizontal: 11, paddingTop: 9 },
  pad: { paddingHorizontal: 12, paddingTop: 12 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  kind: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: light.brand.base },
  articleTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700', color: light.ink.primary, marginTop: 7 },
  articleBody: { fontSize: 12.5, lineHeight: 17, color: 'rgba(11,30,61,0.55)', marginTop: 5 },
  linkTitle: { fontSize: 13.5, lineHeight: 18, fontWeight: '600', color: light.ink.primary, marginTop: 4 },
  quote: { fontSize: 15, lineHeight: 22, color: 'rgba(11,30,61,0.9)' },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingTop: 9, paddingBottom: 11 },
  avatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: light.surface.sunken },
  avatarEmpty: {},
  name: { fontSize: 12.5, fontWeight: '600', color: light.ink.primary, flexShrink: 1 },
});