/**
 * PostInsightsSheet
 *
 * Author-only analytics for one post. Reads get_post_insights, which refuses
 * anyone but the author, so this sheet never has to police access itself.
 *
 * Design intent: reach leads, because it is the number nobody else in this
 * market shows a poster. Engagement rate sits beside it as the interpretation
 * of that reach. Everything below is supporting detail, deliberately quieter.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import { light, typeSize, fontWeight, radius, space } from '../constants/tokens';

type Liker = {
  id: string;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
};

type Insights = {
  reach: number;
  likes: number;
  comments: number;
  reposts: number;
  bookmarks: number;
  engagements: number;
  engagement_rate: number | null;
  posted_at: string;
  video: { unique_viewers: number; total_plays: number; avg_seconds: number } | null;
  recent_likers: Liker[];
};

type Props = {
  postId: string | null;
  onClose: () => void;
  onOpenProfile?: (userId: string) => void;
};

function initials(name?: string | null) {
  if (!name) return 'U';
  const parts = name.trim().split(' ').filter(Boolean);
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function postedAgo(iso?: string) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 30) return `Posted ${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'Posted a month ago' : `Posted ${months} months ago`;
}

export default function PostInsightsSheet({ postId, onClose, onOpenProfile }: Props) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.rpc('get_post_insights', {
      p_post_id: postId,
    });
    if (err) {
      setError(err.message);
      setData(null);
    } else {
      setData(res as Insights);
    }
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    if (postId) load();
    else { setData(null); setError(null); }
  }, [postId, load]);

  const rate = data?.engagement_rate;

  return (
    <Modal visible={!!postId} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={[s.sheet, { paddingBottom: insets.bottom + space.lg }]} onPress={() => {}}>
          <View style={s.handle} />

          <View style={s.headerRow}>
            <View>
              <Text style={s.title}>Insights</Text>
              {data?.posted_at ? <Text style={s.subtitle}>{postedAgo(data.posted_at)}</Text> : null}
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close insights"
            >
              <Feather name="x" size={20} color={light.ink.muted} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={s.centered}>
              <ActivityIndicator color={light.brand.base} />
            </View>
          ) : error ? (
            <View style={s.centered}>
              <Feather name="alert-circle" size={28} color={light.ink.faint} />
              <Text style={s.errorTitle}>Could not load insights</Text>
              <Text style={s.errorSub}>{error}</Text>
              <TouchableOpacity style={s.retry} onPress={load} accessibilityRole="button">
                <Text style={s.retryTxt}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : data ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.heroRow}>
                <View style={s.hero}>
                  <Text style={s.heroVal}>{fmt(data.reach)}</Text>
                  <Text style={s.heroLbl}>Reached</Text>
                  <Text style={s.heroHint}>
                    {data.reach === 1 ? 'person saw this' : 'people saw this'}
                  </Text>
                </View>
                <View style={s.heroSep} />
                <View style={s.hero}>
                  <Text style={[s.heroVal, rate == null && s.heroValMuted]}>
                    {rate == null ? '\u2014' : `${rate}%`}
                  </Text>
                  <Text style={s.heroLbl}>Engaged</Text>
                  <Text style={s.heroHint}>
                    {rate == null ? 'not enough data yet' : 'of the people reached'}
                  </Text>
                </View>
              </View>

              <View style={s.grid}>
                <Stat icon="heart" label="Likes" value={data.likes} />
                <Stat icon="message-circle" label="Comments" value={data.comments} />
                <Stat icon="repeat" label="Reposts" value={data.reposts} />
                <Stat icon="bookmark" label="Saves" value={data.bookmarks} />
              </View>

              {data.video ? (
                <View style={s.block}>
                  <Text style={s.blockTitle}>Video</Text>
                  <View style={s.videoRow}>
                    <VideoStat value={fmt(data.video.unique_viewers)} label="Viewers" />
                    <VideoStat value={fmt(data.video.total_plays)} label="Plays" />
                    <VideoStat value={`${data.video.avg_seconds}s`} label="Avg attention" />
                  </View>
                  <Text style={s.blockNote}>
                    Viewers counts people. Plays counts every watch, including repeats.
                  </Text>
                </View>
              ) : null}

              {data.recent_likers?.length ? (
                <View style={s.block}>
                  <Text style={s.blockTitle}>Liked by</Text>
                  {data.recent_likers.map(l => (
                    <TouchableOpacity
                      key={l.id}
                      style={s.likerRow}
                      activeOpacity={0.7}
                      onPress={() => { onClose(); onOpenProfile?.(l.id); }}
                    >
                      {l.avatar_url ? (
                        <Image source={{ uri: l.avatar_url }} style={s.avatar} />
                      ) : (
                        <View style={[s.avatar, s.avatarFallback]}>
                          <Text style={s.avatarTxt}>{initials(l.full_name)}</Text>
                        </View>
                      )}
                      <View style={s.likerText}>
                        <Text style={s.likerName} numberOfLines={1}>
                          {l.full_name || 'User'}
                        </Text>
                        {l.username ? (
                          <Text style={s.likerHandle} numberOfLines={1}>@{l.username}</Text>
                        ) : null}
                      </View>
                      <Feather name="chevron-right" size={16} color={light.ink.faint} />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Stat({ icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <View style={s.statCell}>
      <Feather name={icon} size={15} color={light.ink.muted} />
      <Text style={s.statVal}>{fmt(value)}</Text>
      <Text style={s.statLbl}>{label}</Text>
    </View>
  );
}

function VideoStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.videoStat}>
      <Text style={s.videoVal}>{value}</Text>
      <Text style={s.videoLbl}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: light.surface.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: light.surface.canvas,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    maxHeight: '86%',
  },
  handle: {
    alignSelf: 'center', width: 38, height: 4, borderRadius: 2,
    backgroundColor: light.surface.hairline, marginBottom: space.md,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: space.lg,
  },
  title: { fontSize: typeSize.title, fontWeight: fontWeight.heavy, color: light.ink.primary, letterSpacing: -0.4 },
  subtitle: { fontSize: typeSize.caption, color: light.ink.muted, marginTop: 2 },

  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: space.sm },
  errorTitle: { fontSize: typeSize.emphasis, fontWeight: fontWeight.bold, color: light.ink.primary },
  errorSub: { fontSize: typeSize.caption, color: light.ink.muted, textAlign: 'center' },
  retry: {
    marginTop: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderRadius: radius.pill, backgroundColor: light.brand.base,
  },
  retryTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  heroRow: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: light.surface.raised,
    borderRadius: radius.lg, paddingVertical: space.lg, marginBottom: space.md,
  },
  hero: { flex: 1, alignItems: 'center', paddingHorizontal: space.sm },
  heroSep: { width: StyleSheet.hairlineWidth, backgroundColor: light.surface.hairline },
  heroVal: { fontSize: 34, fontWeight: fontWeight.heavy, color: light.ink.primary, letterSpacing: -1 },
  heroValMuted: { color: light.ink.faint },
  heroLbl: { fontSize: typeSize.caption, fontWeight: fontWeight.bold, color: light.ink.primary, marginTop: 2 },
  heroHint: { fontSize: typeSize.micro, color: light.ink.muted, marginTop: 1, textAlign: 'center' },

  grid: { flexDirection: 'row', gap: space.xs, marginBottom: space.lg },
  statCell: {
    flex: 1, alignItems: 'center', gap: 3,
    paddingVertical: space.md, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: light.surface.hairline,
  },
  statVal: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },
  statLbl: { fontSize: typeSize.micro, color: light.ink.muted },

  block: { marginBottom: space.lg },
  blockTitle: {
    fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 1.2,
    textTransform: 'uppercase', color: light.ink.muted, marginBottom: space.sm,
  },
  blockNote: { fontSize: typeSize.micro, color: light.ink.faint, marginTop: space.sm, lineHeight: 15 },

  videoRow: { flexDirection: 'row', gap: space.xs },
  videoStat: {
    flex: 1, alignItems: 'center', paddingVertical: space.md,
    borderRadius: radius.md, backgroundColor: light.brand.tintBg,
  },
  videoVal: { fontSize: typeSize.heading, fontWeight: fontWeight.heavy, color: light.ink.primary },
  videoLbl: { fontSize: typeSize.micro, color: light.ink.muted, marginTop: 1 },

  likerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: light.surface.sunken },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.base },
  avatarTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },
  likerText: { flex: 1 },
  likerName: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: light.ink.primary },
  likerHandle: { fontSize: typeSize.caption, color: light.ink.muted },
});