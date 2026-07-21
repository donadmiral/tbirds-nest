import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

type TrendingTopic = {
  tag: string;
  post_count: number;
  total_comments: number;
  score: number;
  unique_users: number;
  velocity: number;
};

type TrendingEvent = {
  id: string;
  title: string;
  attendees: number;
  location: string;
  time: string;
  category: string;
};

const TAG_COLORS: { bg: string; border: string; text: string; badge: string }[] = [
  { bg: '#EEEDFE', border: '#CECBF6', text: '#3C3489', badge: '#CECBF6' },
  { bg: '#E1F5EE', border: '#9FE1CB', text: '#085041', badge: '#9FE1CB' },
  { bg: '#E6F1FB', border: '#B5D4F4', text: '#0C447C', badge: '#B5D4F4' },
  { bg: '#FAEEDA', border: '#FAC775', text: '#633806', badge: '#FAC775' },
  { bg: '#FAECE7', border: '#F5C4B3', text: '#712B13', badge: '#F5C4B3' },
  { bg: '#FBEAF0', border: '#F4C0D1', text: '#993556', badge: '#F4C0D1' },
];

const EVENT_ICONS: Record<string, string> = {
  Dinner: '🍽️',
  'Coffee Chat': '☕',
  Study: '📚',
  Trip: '✈️',
  Sports: '⚽',
  Networking: '🤝',
  Party: '🎉',
  Other: '✨',
};

function getTagColor(index: number) {
  return TAG_COLORS[index % TAG_COLORS.length];
}

type Props = {
  refreshSignal?: number;
};

export default function TrendingTopicsStrip({ refreshSignal }: Props) {
  const navigation = useNavigation<any>();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  const [topics, setTopics] = useState<TrendingTopic[]>([]);
  const [events, setEvents] = useState<TrendingEvent[]>([]);
  const [error, setError] = useState(false);

  const clientSideFallback = useCallback(async (): Promise<TrendingTopic[]> => {
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data: posts, error: postsErr } = await supabase
        .from('posts')
        .select('id, content, likes_count, comments_count, reposts_count, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200);

      if (postsErr || !posts) return [];

      const tagMap: Record<string, {
        posts: Set<string>;
        likes: number;
        comments: number;
        reposts: number;
        earliestMs: number;
      }> = {};

      for (const post of posts) {
        const content = post.content || '';
        const tags = content.match(/#[A-Za-z0-9_]+/g);
        if (!tags) continue;

        const seenInPost = new Set<string>();

        for (const rawTag of tags) {
          const tag = rawTag.toLowerCase();
          if (seenInPost.has(tag)) continue;
          seenInPost.add(tag);

          if (!tagMap[tag]) {
            tagMap[tag] = { posts: new Set(), likes: 0, comments: 0, reposts: 0, earliestMs: Date.now() };
          }
          tagMap[tag].posts.add(post.id);
          tagMap[tag].likes += (post.likes_count || 0);
          tagMap[tag].comments += (post.comments_count || 0);
          tagMap[tag].reposts += (post.reposts_count || 0);

          const postMs = new Date(post.created_at).getTime();
          if (postMs < tagMap[tag].earliestMs) {
            tagMap[tag].earliestMs = postMs;
          }
        }
      }

      return Object.entries(tagMap)
        .map(([tag, data]) => {
          const hoursSinceFirst = (Date.now() - data.earliestMs) / 3600000;
          const rawScore =
            (data.posts.size * 4) +
            (data.comments * 3) +
            (data.reposts * 5) +
            (data.likes * 1);
          const score = rawScore * Math.exp(-hoursSinceFirst / 36);

          return {
            tag,
            post_count: data.posts.size,
            total_comments: data.comments,
            score,
            unique_users: 0,
            velocity: 0,
          };
        })
        .filter(t => t.post_count >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
    } catch {
      return [];
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const { data: minglePosts, error: mingleErr } = await supabase
        .from('mingle_posts')
        .select('id, title, category, location, event_time, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

      if (mingleErr || !minglePosts || minglePosts.length === 0) return;

      const postIds = minglePosts.map((p: any) => p.id);
      const { data: attData } = await supabase
        .from('mingle_post_attendees')
        .select('post_id')
        .in('post_id', postIds);

      const attCount: Record<string, number> = {};
      (attData || []).forEach((a: any) => {
        attCount[a.post_id] = (attCount[a.post_id] || 0) + 1;
      });

      const eventList: TrendingEvent[] = minglePosts
        .map((p: any) => ({
          id: p.id,
          title: p.title,
          attendees: attCount[p.id] || 0,
          location: p.location || '',
          time: p.event_time || '',
          category: p.category || 'Other',
        }))
        .filter((e: TrendingEvent) => e.attendees >= 2)
        .sort((a: TrendingEvent, b: TrendingEvent) => b.attendees - a.attendees)
        .slice(0, 5);

      setEvents(eventList);
    } catch {
      // Mingle fetch failure is non-fatal
    }
  }, []);

  const load = useCallback(async () => {
    if (!myId) {
      return;
    }

    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_trending_topics', {
        p_days: 7,
        p_limit: 15,
      });

      if (rpcErr) {
        const fallbackTopics = await clientSideFallback();
        setTopics(fallbackTopics);
      } else {
        setTopics((rpcData || []) as TrendingTopic[]);
      }

      await loadEvents();
    } catch {
      setError(true);
    }
  }, [myId, clientSideFallback, loadEvents]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel('trending_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        (payload: any) => {
          const content = payload.new?.content;
          if (!content || typeof content !== 'string') return;
          if (!/#[A-Za-z0-9_]+/.test(content)) return;

          if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
          realtimeTimerRef.current = setTimeout(() => {
            load();
          }, 10000);
        }
      )
      .subscribe();

    return () => {
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [load]);

  if (error || (topics.length === 0 && events.length === 0)) {
    return null;
  }

  return (
    <View style={styles.container}>
      {topics.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Hot Topics</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillRow}
          >
            {topics.map((topic, i) => {
              const color = getTagColor(i);
              return (
                <TouchableOpacity
                  key={topic.tag}
                  style={[styles.pill, { backgroundColor: color.bg, borderColor: color.border }]}
                  activeOpacity={0.75}
                  onPress={() => {
                    navigation.navigate('TrendFeed', { tag: topic.tag });
                  }}
                >
                  <Text style={[styles.pillText, { color: color.text }]}>{topic.tag}</Text>
                  <View style={[styles.pillBadge, { backgroundColor: color.badge }]}>
                    <Text style={[styles.pillBadgeText, { color: color.text }]}>{topic.unique_users || topic.post_count} people</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {events.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.eventRow}
        >
          {events.map((event) => (
            <TouchableOpacity
              key={event.id}
              style={styles.eventCard}
              activeOpacity={0.75}
              onPress={() => {
                navigation.navigate('MingleDetails', { postId: event.id });
              }}
            >
              <View style={styles.eventIcon}>
                <Text style={{ fontSize: 16 }}>
                  {EVENT_ICONS[event.category] || '✨'}
                </Text>
              </View>
              <View style={styles.eventInfo}>
                <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                <Text style={styles.eventMeta} numberOfLines={1}>
                  {event.attendees} going{event.location ? ` · ${event.location}` : ''}{event.time ? ` · ${event.time}` : ''}
                </Text>
              </View>
              <View style={styles.joinChip}>
                <Text style={styles.joinChipText}>Join</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  pillRow: {
    paddingHorizontal: 14,
    gap: 6,
    paddingBottom: 0,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 0.5,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pillBadge: {
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  pillBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  eventRow: {
    paddingHorizontal: 14,
    gap: 8,
    paddingTop: 8,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F0F0F0',
    minWidth: 200,
  },
  eventIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F0F0F0',
  },
  eventInfo: {
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000000',
  },
  eventMeta: {
    fontSize: 10,
    color: '#8E8E93',
    marginTop: 2,
  },
  joinChip: {
    backgroundColor: '#E1F5EE',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  joinChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#085041',
  },
});