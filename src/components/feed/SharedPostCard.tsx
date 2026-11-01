/**
 * SharedPostCard — the one card a post becomes when it travels: into a chat
 * bubble (Send to…) or into a thread (Add to thread / Quote). Phone tokens:
 * navy ink, pearl accent, hairline border, radius 20. Two layouts:
 *   compact  → row: text left, 64px media right (threads, quoted posts)
 *   full     → media hero on top, author row, text (chat bubbles)
 */
import { themedSheet } from '../../theme/useTheme';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import VerifiedBadge from '../VerifiedBadge';
import TierName from '../TierName';
import { privateImageCachePolicy } from '../../../shared/mediaDelivery';
import { sharedPostImageUri, sharedPostMediaKind, sharedPostMediaLabel } from '../../../shared/sharedPostPreview';

export type SharedPostData = {
  id: string;
  content?: string | null;
  author?: { id?: string; full_name?: string | null; username?: string | null; avatar_url?: string | null } | null;
  media?: { url: string; media_type: string; thumbnail_url?: string | null } | null;
  mediaCount?: number;
};

export function SharedPostThumbnail({ postId, media, mediaCount = 0, compact = false, width = 240 }: {
  postId: string; media: NonNullable<SharedPostData['media']>; mediaCount?: number; compact?: boolean; width?: number;
}) {
  const uri = sharedPostImageUri(media);
  const identity = `${postId}:${uri ?? ''}`;
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!uri && failed !== identity;
  const kind = sharedPostMediaKind(media.media_type, media.url);
  const label = sharedPostMediaLabel(media, mediaCount);
  const icon = mediaCount > 1 ? 'layers' : kind === 'video' ? 'video' : kind === 'audio' ? 'music' : kind === 'file' ? 'file-text' : 'image';
  return (
    <View accessibilityLabel={`${label} from original post${failed === identity ? '. Preview unavailable' : ''}`} style={compact ? c.thumbWrap : { width: '100%', height: Math.round(width * 0.95), backgroundColor: c.thumbWrap.backgroundColor }}>
      <View style={c.previewFallback}>
        <Feather name={icon} size={compact ? 20 : 32} color={c.previewLabel.color} />
        <Text style={c.previewLabel} numberOfLines={1}>{label}</Text>
      </View>
      {showImage ? <ExpoImage key={identity} recyclingKey={identity} source={{ uri }} cachePolicy={privateImageCachePolicy(uri)} transition={0} style={StyleSheet.absoluteFill} contentFit="cover" onError={() => setFailed(identity)} /> : null}
      {showImage && kind === 'video' ? <View style={compact ? c.playSmall : c.playBig}><Feather name="play" size={compact ? 11 : 18} color={compact ? '#FFFFFF' : '#0B1E3D'} /></View> : null}
      {showImage && mediaCount > 1 ? <View style={c.countPill}><Feather name="layers" size={11} color="#FFFFFF" /><Text style={c.countTxt}>{mediaCount}</Text></View> : null}
    </View>
  );
}

export default function SharedPostCard({ post, layout = 'full', width = 240, onPress, onAuthorPress }: {
  post: SharedPostData | null | undefined; layout?: 'full' | 'compact'; width?: number; onPress?: () => void; onAuthorPress?: () => void;
}) {
  const name = post?.author?.full_name || post?.author?.username || 'Post';
  const media = post?.media ?? null;
  const mediaLabel = sharedPostMediaLabel(media, post?.mediaCount);
  const text = (post?.content || '').trim();

  const Author = (
    <View style={c.authorRow}>
      {post?.author?.avatar_url ? <ExpoImage source={{ uri: post.author.avatar_url }} style={c.avatar} contentFit="cover" /> : <View style={[c.avatar, { backgroundColor: 'rgba(11,30,61,0.10)' }]} />}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
        <TierName userId={post?.author?.id} text={name} baseStyle={c.name} />
        {post?.author?.id ? <View style={{ marginLeft: 4 }}><VerifiedBadge userId={post.author.id} size={12} /></View> : null}
        {post?.author?.username ? <Text style={c.handle} numberOfLines={1}> @{post.author.username}</Text> : null}
      </View>
      <Feather name="corner-up-right" size={13} color="rgba(11,30,61,0.35)" />
    </View>
  );

  if (layout === 'compact') {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[c.card, c.compact]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {Author}
          <Text style={c.textCompact} numberOfLines={media ? 2 : 4}>{text || (media ? mediaLabel : 'Tap to view post')}</Text>
        </View>
        {media ? (
          <SharedPostThumbnail postId={post!.id} media={media} mediaCount={post?.mediaCount} compact />
        ) : null}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[c.card, { width }]}>
      {media ? (
        <SharedPostThumbnail postId={post!.id} media={media} mediaCount={post?.mediaCount} width={width} />
      ) : null}
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 }}>
        <TouchableOpacity onPress={onAuthorPress || onPress} activeOpacity={0.7}>{Author}</TouchableOpacity>
        {text ? <Text style={[c.text, !media && c.textLarge]} numberOfLines={media ? 3 : 8}>{text}</Text> : (!media ? <Text style={c.hint}>Tap to view post</Text> : null)}
      </View>
      <View style={c.foot}><Feather name="message-circle" size={12} color="rgba(11,30,61,0.45)" /><Text style={c.footTxt}>Open post</Text></View>
    </TouchableOpacity>
  );
}

const c = themedSheet((t) => ({
  card: { backgroundColor: t.surface.canvas, borderRadius: 20, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline, shadowColor: t.ink.primary, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 24, height: 24, borderRadius: 12 },
  name: { fontSize: 13, fontWeight: '800', color: t.ink.primary, flexShrink: 1 },
  handle: { fontSize: 12, color: t.ink.muted, flexShrink: 1 },
  text: { marginTop: 8, fontSize: 14, lineHeight: 19, color: t.ink.primary },
  textLarge: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  textCompact: { marginTop: 6, fontSize: 13.5, lineHeight: 18, color: t.ink.primary },
  hint: { marginTop: 8, fontSize: 13, color: t.ink.muted },
  thumbWrap: { width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: t.surface.sunken },
  previewFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 3, padding: 3 },
  previewLabel: { color: t.ink.muted, fontSize: 10, fontWeight: '600' },
  playSmall: { position: 'absolute', left: 22, top: 22, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.7)', alignItems: 'center', justifyContent: 'center' },
  playBig: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  countPill: { position: 'absolute', right: 8, top: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(11,30,61,0.6)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  countTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.surface.hairline, backgroundColor: t.surface.raised },
  footTxt: { fontSize: 12, fontWeight: '700', color: t.ink.muted },
}));
