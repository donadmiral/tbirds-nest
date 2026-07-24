import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Image,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { storiesService, CatchupUser } from '../../services/storiesService';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Props = {
  mode?: 'primary' | 'all' | 'global';
};

const NAVY = '#0B1E3D';
const SEEN = '#D1D5DB';
const TEXT_PRIMARY = '#1A1A1A';

const PLATINUM_GLOW = '#F5F0E8';
const PLATINUM_START = '#C9BFB0';
const PLATINUM_END = '#A89F91';

const RING_SIZE = 66;
const RING_CENTER = RING_SIZE / 2;
const RING_RADIUS = 30;
const AVATAR_SIZE = 54;
const ARC_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const ARC_DASH = 35;
const ARC_GAP = ARC_CIRCUMFERENCE - ARC_DASH;

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function hashSpeed(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return 3500 + (Math.abs(hash) % 1500);
}

function PlatinumRing({ userId }: { userId: string }) {
  const arcOffset = useRef(new Animated.Value(0)).current;
  const speed = hashSpeed(userId);
  const safeId = `plat_${userId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(arcOffset, {
        toValue: ARC_CIRCUMFERENCE,
        duration: speed,
        useNativeDriver: false,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [arcOffset, speed]);

  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
      <Defs>
        <LinearGradient id={safeId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={PLATINUM_GLOW} />
          <Stop offset="0.4" stopColor={PLATINUM_START} />
          <Stop offset="1" stopColor={PLATINUM_END} />
        </LinearGradient>
      </Defs>
      {/* Layer 1: Platinum gradient ring */}
      <Circle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS}
        fill="none"
        stroke={`url(#${safeId})`}
        strokeWidth={2.5}
      />
      {/* Layer 2: Inner glow edge */}
      <Circle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS - 1.5}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth={0.5}
      />
      {/* Layer 3: Moving highlight arc */}
      <AnimatedCircle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS}
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth={1.5}
        strokeDasharray={`${ARC_DASH} ${ARC_GAP}`}
        strokeLinecap="round"
        strokeDashoffset={arcOffset}
      />
    </Svg>
  );
}

function SeenRing() {
  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
      <Circle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS}
        fill="none"
        stroke={SEEN}
        strokeWidth={2}
      />
    </Svg>
  );
}

function DashedRing() {
  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
      <Circle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS}
        fill="none"
        stroke="#E5E7EB"
        strokeWidth={2}
        strokeDasharray="6 4"
      />
    </Svg>
  );
}

function OwnSeenRing() {
  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
      <Defs>
        <LinearGradient id="plat_own" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={PLATINUM_GLOW} stopOpacity={0.5} />
          <Stop offset="1" stopColor={PLATINUM_END} stopOpacity={0.5} />
        </LinearGradient>
      </Defs>
      <Circle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS}
        fill="none"
        stroke="url(#plat_own)"
        strokeWidth={2}
      />
    </Svg>
  );
}

function AvatarContent({ avatarUrl, name }: { avatarUrl: string | null; name: string | null }) {
  return (
    <View style={s.avatarPosition}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={s.avatarImg} />
      ) : (
        <View style={[s.avatarImg, s.avatarFb]}>
          <Text style={s.avatarFbTxt}>{initials(name)}</Text>
        </View>
      )}
    </View>
  );
}

function SkeletonBubble({ index, showPlus }: { index: number; showPlus: boolean }) {
  const pulse = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.7,
          duration: 900,
          useNativeDriver: true,
          delay: index * 80,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse, index]);

  return (
    <View style={s.bubble}>
      <View style={s.ringContainer}>
        <Animated.View style={[s.skeletonCircle, { opacity: pulse }]} />
        {showPlus && (
          <View style={s.plusBadge}>
            <Feather name="plus" size={12} color="#FFFFFF" />
          </View>
        )}
      </View>
      <Animated.View style={[s.skeletonBar, { opacity: pulse }]} />
    </View>
  );
}

function StoryStrip({ mode = 'all' }: Props) {
  const navigation = useNavigation<any>();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  const [catchup, setCatchup] = useState<CatchupUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [myHasStories, setMyHasStories] = useState(false);

  // Phase 4.0A: Track which userIds were sent to the viewer
  // so we can optimistically mark them as seen on focus return
  const viewerOpenedForRef = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await storiesService.getCatchupFeed(mode, 30);
      setCatchup(rows);
      setMyHasStories(!!myId && rows.some(r => r.user_id === myId));
    } catch (e) {
      console.log('[StoryStrip.load]', e);
    } finally {
      setLoading(false);
    }
  }, [mode, myId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      // Phase 4.0A: On focus return, apply optimistic seen state
      // before the RPC fetch, so rings update instantly
      const viewedIds = viewerOpenedForRef.current;
      if (viewedIds && viewedIds.size > 0) {
        setCatchup(prev => prev.map(user =>
          viewedIds.has(user.user_id)
            ? { ...user, has_unseen: false, unseen_count: 0 }
            : user
        ));
        viewerOpenedForRef.current = null;
      }

      // Then fetch fresh data from the server to reconcile
      load();
    }, [load])
  );

  useEffect(() => {
    const ch = supabase
      .channel('stories_live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'stories' },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const openCreationMenu = () => {
    navigation.navigate('StoryCamera');
  };

  const openViewer = (startUserId: string) => {
    const userIds = catchup.map(c => c.user_id);

    // Phase 4.0A: Record all userIds sent to the viewer
    // On return, these will be optimistically marked as seen
    viewerOpenedForRef.current = new Set([startUserId]);

    navigation.navigate('StoryViewer', {
      userIds,
      startUserId,
    });
  };

  const renderSelfBubble = () => {
    const myCatchup = catchup.find(c => c.user_id === myId);
    const hasUnseen = myCatchup?.has_unseen ?? false;

    return (
      <TouchableOpacity
        style={s.bubble}
        activeOpacity={0.75}
        onPress={() => {
          if (myHasStories && myId) {
            openViewer(myId);
          } else {
            openCreationMenu();
          }
        }}
      >
        <View style={s.ringContainer}>
          {myHasStories
            ? hasUnseen
              ? <PlatinumRing userId={myId!} />
              : <OwnSeenRing />
            : <DashedRing />
          }
          <AvatarContent avatarUrl={profile?.avatar_url ?? null} name={profile?.full_name ?? null} />
          <TouchableOpacity
            style={s.plusBadge}
            onPress={openCreationMenu}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Feather name="plus" size={12} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <Text style={s.nameTxt} numberOfLines={1}>
          {myHasStories ? 'You' : 'Your story'}
        </Text>
      </TouchableOpacity>
    );
  };

  const muteUser = (user: CatchupUser) => {
    if (!myId || user.user_id === myId) return;
    Alert.alert(
      'Mute ' + (user.full_name || 'this person') + '?',
      'Their stories stop appearing here. You stay following them and they are not told.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mute',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('muted_stories').upsert({ user_id: myId, muted_id: user.user_id });
              load();
            } catch (e: any) {
              Alert.alert('Could not mute', e?.message || 'Try again.');
            }
          },
        },
      ]
    );
  };
  const renderUserBubble = (user: CatchupUser) => {
    return (
      <TouchableOpacity
        key={user.user_id}
        style={s.bubble}
        activeOpacity={0.75}
        onPress={() => openViewer(user.user_id)}
        onLongPress={() => muteUser(user)}
        delayLongPress={450}
      >
        <View style={s.ringContainer}>
          {user.has_unseen
            ? <PlatinumRing userId={user.user_id} />
            : <SeenRing />
          }
          <AvatarContent avatarUrl={user.avatar_url} name={user.full_name} />
        </View>
        <Text style={[s.nameTxt, user.has_unseen && s.nameTxtUnseen]} numberOfLines={1}>
          {user.full_name?.split(' ')[0] || 'User'}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading && catchup.length === 0) {
    return (
      <View style={s.container}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.scrollContent}
        >
          {[0, 1, 2, 3, 4, 5].map(i => (
            <SkeletonBubble key={i} index={i} showPlus={i === 0} />
          ))}
        </ScrollView>
      </View>
    );
  }

  const others = catchup.filter(c => c.user_id !== myId);

  return (
    <View style={s.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
        {renderSelfBubble()}
        {others.map(renderUserBubble)}
      </ScrollView>
    </View>
  );
}

export default React.memo(StoryStrip);

const s = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
  },
  scrollContent: {
    paddingHorizontal: 14,
    gap: 14,
  },
  bubble: {
    width: 68,
    alignItems: 'center',
  },
  ringContainer: {
    width: RING_SIZE,
    height: RING_SIZE,
    marginBottom: 6,
    position: 'relative',
  },
  avatarPosition: {
    position: 'absolute',
    top: (RING_SIZE - AVATAR_SIZE) / 2,
    left: (RING_SIZE - AVATAR_SIZE) / 2,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  avatarImg: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFb: {
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFbTxt: {
    fontSize: 17,
    fontWeight: '700',
    color: NAVY,
  },
  plusBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    zIndex: 2,
  },
  nameTxt: {
    fontSize: 11,
    fontWeight: '400',
    color: TEXT_PRIMARY,
    textAlign: 'center',
    maxWidth: 68,
    letterSpacing: -0.1,
  },
  nameTxtUnseen: {
    fontWeight: '600',
    color: '#000000',
  },
  skeletonCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 33,
    backgroundColor: '#F2F2F7',
  },
  skeletonBar: {
    width: 40,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F2F2F7',
  },
});