import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  campusMomentService,
  type CampusMomentPrompt,
} from '../services/campusMomentService';
import { useAuthStore } from '../stores/authStore';

type CampusMomentCardProps = {
  refreshKey?: number;
};

function formatTimeLeft(windowEnd: string): string {
  const diff = new Date(windowEnd).getTime() - Date.now();
  if (diff <= 0) return 'Window closed';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m left`;
  return 'Less than 1m';
}

export default function CampusMomentCard({ refreshKey }: CampusMomentCardProps) {
  const navigation = useNavigation<any>();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [moment, setMoment] = useState<CampusMomentPrompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [timeLeftText, setTimeLeftText] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(8)).current;
  const skeletonAnim = useRef(new Animated.Value(0.3)).current;
  const animatedRef = useRef(false);

  useEffect(() => {
    if (!loading) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(skeletonAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [loading, skeletonAnim]);

  const loadMoment = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setError(false);

    let instId = institutionId;
    let instName = institutionName;

    if (!instId) {
      try {
        const result = await campusMomentService.getUserInstitutionId(userId);
        if (!result) { setLoading(false); setMoment(null); return; }
        instId = result.id;
        instName = result.name;
        setInstitutionId(instId);
        setInstitutionName(instName);
      } catch {
        setLoading(false);
        setError(true);
        return;
      }
    }

    try {
      const data = await campusMomentService.getTodaysMoment(instId);
      setMoment(data);
      if (data) {
        setTimeLeftText(formatTimeLeft(data.window_end));
      }
    } catch {
      setError(true);
      setMoment(null);
    } finally {
      setLoading(false);
    }
  }, [userId, institutionId, institutionName]);

  useEffect(() => {
    loadMoment();
  }, [loadMoment]);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      loadMoment();
    }
  }, [refreshKey, loadMoment]);

  useEffect(() => {
    if (!moment) return;
    const interval = setInterval(() => {
      setTimeLeftText(formatTimeLeft(moment.window_end));
    }, 30000);
    return () => clearInterval(interval);
  }, [moment]);

  useEffect(() => {
    if (moment && !loading && !animatedRef.current) {
      animatedRef.current = true;
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [moment, loading, fadeAnim, slideAnim]);

  const handleShare = useCallback(() => {
    if (!moment) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('StoryCreationMenu', {
      campusMomentPromptId: moment.id,
      campusMomentPromptText: moment.prompt_text,
    });
  }, [moment, navigation]);

  const handleViewResponses = useCallback(async () => {
    if (!moment) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const feed = await campusMomentService.getMomentFeed(moment.id);
      if (feed.length === 0) return;

      const seen = new Set<string>();
      const userIds: string[] = [];

      for (const item of feed) {
        if (!seen.has(item.user_id)) {
          seen.add(item.user_id);
          userIds.push(item.user_id);
        }
      }

      if (userIds.length === 0) return;

      navigation.navigate('StoryViewer', {
        userIds,
        startUserId: userIds[0],
      });
    } catch {}
  }, [moment, navigation]);

  if (loading) {
    return (
      <View style={s.wrap}>
        <Animated.View style={[s.skeleton, { opacity: skeletonAnim }]} />
      </View>
    );
  }

  if (!moment || error) return null;

  const windowActive = new Date(moment.window_end).getTime() > Date.now();
  const hasPosted = moment.my_post_id !== null;

  const gradientColors: readonly [string, string] = windowActive
    ? ['#F59E0B', '#D97706']
    : ['#6B7280', '#4B5563'];

  return (
    <Animated.View style={[s.wrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <LinearGradient colors={gradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.card}>
        <View style={s.headerRow}>
          <View style={s.labelRow}>
            <Feather name="sun" size={12} color="rgba(255,255,255,0.85)" />
            <Text style={s.label}>TODAY'S MOMENT</Text>
          </View>

          {institutionName && (
            <View style={s.campusPill}>
              <Feather name="award" size={9} color="rgba(255,255,255,0.7)" />
              <Text style={s.campusTxt} numberOfLines={1}>{institutionName}</Text>
            </View>
          )}
        </View>

        <Text style={s.prompt}>{moment.prompt_text}</Text>

        {windowActive && (
          <View style={s.timerRow}>
            <Feather name="clock" size={11} color="rgba(255,255,255,0.6)" />
            <Text style={s.timerTxt}>{timeLeftText}</Text>
          </View>
        )}

        {!windowActive && !hasPosted && (
          <View style={s.timerRow}>
            <Feather name="clock" size={11} color="rgba(255,255,255,0.5)" />
            <Text style={s.timerTxt}>Window closed. You can still post late.</Text>
          </View>
        )}

        {!hasPosted && (
          <TouchableOpacity style={s.shareBtn} onPress={handleShare} activeOpacity={0.75}>
            <Feather name="camera" size={15} color="#FFF" />
            <Text style={s.shareBtnTxt}>Share your moment</Text>
          </TouchableOpacity>
        )}

        {hasPosted && (
          <TouchableOpacity style={s.postedBtn} onPress={handleViewResponses} activeOpacity={0.75}>
            <View style={s.checkCircle}>
              <Feather name="check" size={11} color="#FFF" />
            </View>
            <Text style={s.postedBtnTxt}>You shared</Text>

            {moment.my_is_late && (
              <View style={s.lateBadge}>
                <Feather name="clock" size={9} color="rgba(255,255,255,0.8)" />
                <Text style={s.lateTxt}>Late</Text>
              </View>
            )}

            <View style={{ flex: 1 }} />
            <Text style={s.viewTxt}>View</Text>
            <Feather name="chevron-right" size={14} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        )}

        {moment.total_posts > 0 && (
          <TouchableOpacity onPress={handleViewResponses} activeOpacity={0.7} style={s.countRow}>
            <Feather name="users" size={11} color="rgba(255,255,255,0.6)" />
            <Text style={s.countTxt}>
              {moment.total_posts} {moment.total_posts === 1 ? 'person' : 'people'} shared
            </Text>
          </TouchableOpacity>
        )}

        {moment.total_posts === 0 && !hasPosted && (
          <Text style={s.emptyTxt}>Be the first from your campus to share.</Text>
        )}
      </LinearGradient>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
  },
  skeleton: {
    height: 140,
    borderRadius: 18,
    backgroundColor: '#E8E8E8',
  },
  card: {
    borderRadius: 18,
    padding: 16,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.5,
  },
  campusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 140,
  },
  campusTxt: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
    flexShrink: 1,
  },
  prompt: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFF',
    lineHeight: 24,
    marginTop: 10,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  timerTxt: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.6)',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  shareBtnTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
  },
  postedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(52,199,89,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postedBtnTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
  },
  lateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  lateTxt: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
  },
  viewTxt: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    justifyContent: 'center',
    marginTop: 10,
  },
  countTxt: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  emptyTxt: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    marginTop: 8,
  },
});