import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Animated,
  PanResponder,
  ActivityIndicator,
  Alert,
  StatusBar,
  Modal,
  FlatList,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { VideoView, useVideoPlayer } from 'expo-video';
import {
  storiesService,
  StoryRow,
  StoryViewer,
  StoryTextSticker,
  StoryStickerStyle,
} from '../../services/storiesService';
import { useAuthStore } from '../../stores/authStore';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const IMAGE_DURATION_MS = 5000;
const VIDEO_MAX_MS = 15000;
const LONG_PRESS_MS = 200;

type RouteParams = {
  userIds: string[];
  startUserId: string;
};

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function stickerTextStyle(style: StoryStickerStyle, color: string) {
  switch (style) {
    case 'classic':
      return {
        textStyle: {
          fontSize: 30, fontWeight: '700' as const, color,
          textShadowColor: 'rgba(0,0,0,0.45)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 3,
        },
        wrapperStyle: {} as const,
      };
    case 'bold':
      return {
        textStyle: {
          fontSize: 34, fontWeight: '900' as const, color,
          letterSpacing: -0.5,
          textShadowColor: 'rgba(0,0,0,0.35)',
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 4,
        },
        wrapperStyle: {} as const,
      };
    case 'typewriter':
      return {
        textStyle: {
          fontSize: 26, fontWeight: '600' as const, color,
          fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
          letterSpacing: 0.5,
        },
        wrapperStyle: {
          backgroundColor: 'rgba(0,0,0,0.55)',
          paddingHorizontal: 10, paddingVertical: 6,
          borderRadius: 6,
        } as const,
      };
    case 'neon':
      return {
        textStyle: {
          fontSize: 32, fontWeight: '800' as const, color,
          textShadowColor: color,
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: 14,
        },
        wrapperStyle: {} as const,
      };
    case 'highlight': {
      const isLight = color.toUpperCase() === '#FFFFFF' || color.toUpperCase() === '#FFCC00';
      return {
        textStyle: {
          fontSize: 28, fontWeight: '800' as const,
          color: isLight ? '#000000' : '#FFFFFF',
        },
        wrapperStyle: {
          backgroundColor: color,
          paddingHorizontal: 10, paddingVertical: 5,
          borderRadius: 4,
        } as const,
      };
    }
  }
}

function StickerOverlay({
  stickers, containerW, containerH,
}: { stickers: StoryTextSticker[]; containerW: number; containerH: number }) {
  if (!stickers || stickers.length === 0 || containerW === 0 || containerH === 0) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {stickers.map(st => {
        const { textStyle, wrapperStyle } = stickerTextStyle(st.style, st.color);
        return (
          <View
            key={st.id}
            style={{
              position: 'absolute',
              left: st.nx * containerW,
              top: st.ny * containerH,
              transform: [
                { translateX: -80 },
                { translateY: -25 },
                { scale: st.scale },
                { rotate: `${st.rotation}rad` },
              ],
              alignItems: 'center',
              justifyContent: 'center',
              width: 160,
            }}
          >
            <View style={wrapperStyle}>
              <Text style={textStyle}>{st.text}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function StoryViewerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  const params = route.params as RouteParams;
  const userIds = params?.userIds || [];
  const startUserId = params?.startUserId;

  const initialUserIndex = useMemo(() => {
    const idx = userIds.indexOf(startUserId);
    return idx >= 0 ? idx : 0;
  }, [userIds, startUserId]);

  const [userIndex, setUserIndex] = useState(initialUserIndex);
  const currentUserId = userIds[userIndex];

  const [stories, setStories] = useState<StoryRow[]>([]);
  const [storyIndex, setStoryIndex] = useState(0);
  const [storyUser, setStoryUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaSize, setMediaSize] = useState({ w: SCREEN_W, h: SCREEN_H });

  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewers, setViewers] = useState<StoryViewer[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const progressValue = useRef(0);

  const translateY = useRef(new Animated.Value(0)).current;

  const currentStory = stories[storyIndex];
  const isVideo = currentStory?.media_type === 'video';

  const videoPlayer = useVideoPlayer(
    isVideo && currentStory ? currentStory.media_url : null,
    (player) => {
      if (player) {
        player.loop = false;
        player.muted = false;
      }
    }
  );

  const loadForCurrentUser = useCallback(async () => {
    if (!currentUserId) return;
    setLoading(true);
    setMediaReady(false);
    try {
      const [userStories, profileRes] = await Promise.all([
        storiesService.getUserStories(currentUserId),
        import('../../services/supabase').then(({ supabase }) =>
          supabase
            .from('profiles')
            .select('id, full_name, username, avatar_url')
            .eq('id', currentUserId)
            .maybeSingle()
        ),
      ]);
      setStories(userStories);
      setStoryUser(profileRes.data || null);
      const firstUnseen = userStories.findIndex(s => !s.is_viewed);
      setStoryIndex(firstUnseen >= 0 ? firstUnseen : 0);
    } catch (e) {
      console.log('[StoryViewer.load]', e);
      setStories([]);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadForCurrentUser();
  }, [loadForCurrentUser]);

  const stopProgress = useCallback(() => {
    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }
    progressAnim.stopAnimation((val: number) => {
      progressValue.current = val;
    });
  }, [progressAnim]);

  const resetProgress = useCallback(() => {
    stopProgress();
    progressValue.current = 0;
    progressAnim.setValue(0);
  }, [progressAnim, stopProgress]);

  const startProgress = useCallback(
    (durationMs: number, fromValue = 0) => {
      stopProgress();
      progressAnim.setValue(fromValue);
      const remainingMs = durationMs * (1 - fromValue);
      const anim = Animated.timing(progressAnim, {
        toValue: 1,
        duration: remainingMs,
        useNativeDriver: false,
      });
      animRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) {
          advanceForward();
        }
      });
    },
    [progressAnim, stopProgress]
  );

  const advanceForward = useCallback(() => {
    resetProgress();
    if (storyIndex < stories.length - 1) {
      setStoryIndex(storyIndex + 1);
    } else {
      if (userIndex < userIds.length - 1) {
        setUserIndex(userIndex + 1);
      } else {
        navigation.goBack();
      }
    }
  }, [resetProgress, storyIndex, stories.length, userIndex, userIds.length, navigation]);

  const advanceBackward = useCallback(() => {
    resetProgress();
    if (storyIndex > 0) {
      setStoryIndex(storyIndex - 1);
    } else {
      if (userIndex > 0) {
        setUserIndex(userIndex - 1);
      }
    }
  }, [resetProgress, storyIndex, userIndex]);

  useEffect(() => {
    if (!currentStory) return;

    if (myId && currentStory.user_id !== myId) {
      storiesService.markViewed(currentStory.id);
    }

    if (!isVideo) {
      const timer = setTimeout(() => {
        if (!mediaReady) setMediaReady(true);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [currentStory, isVideo, myId, mediaReady]);

  useEffect(() => {
    if (!currentStory) return;
    if (!mediaReady) return;

    if (paused) {
      stopProgress();
      if (isVideo && videoPlayer) {
        try { videoPlayer.pause(); } catch {}
      }
      return;
    }

    let durationMs: number;
    if (isVideo) {
      const d = currentStory.duration_sec ? currentStory.duration_sec * 1000 : VIDEO_MAX_MS;
      durationMs = Math.min(d, VIDEO_MAX_MS);
      if (videoPlayer) {
        try { videoPlayer.play(); } catch {}
      }
    } else {
      durationMs = IMAGE_DURATION_MS;
    }

    startProgress(durationMs, progressValue.current);
    return () => stopProgress();
  }, [mediaReady, paused, currentStory, isVideo, videoPlayer, startProgress, stopProgress]);

  useEffect(() => {
    setMediaReady(false);
    resetProgress();
  }, [storyIndex, userIndex, resetProgress]);

  const pressStartTimestamp = useRef(0);
  const pressStartX = useRef(0);
  const longPressTimer = useRef<any>(null);
  const didLongPress = useRef(false);
  const didSwipe = useRef(false);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dy) > 10 || Math.abs(g.dx) > 10,
        onPanResponderGrant: (e) => {
          pressStartTimestamp.current = Date.now();
          pressStartX.current = e.nativeEvent.pageX;
          didLongPress.current = false;
          didSwipe.current = false;

          if (longPressTimer.current) clearTimeout(longPressTimer.current);
          longPressTimer.current = setTimeout(() => {
            didLongPress.current = true;
            setPaused(true);
          }, LONG_PRESS_MS);
        },
        onPanResponderMove: (_e, g) => {
          if (g.dy > 5 && Math.abs(g.dy) > Math.abs(g.dx)) {
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
            didSwipe.current = true;
            if (g.dy > 0) {
              translateY.setValue(g.dy);
            }
          }
        },
        onPanResponderRelease: (e, g) => {
          const heldMs = Date.now() - pressStartTimestamp.current;

          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
          }

          if (didSwipe.current) {
            if (g.dy > 120) {
              Animated.timing(translateY, {
                toValue: SCREEN_H,
                duration: 180,
                useNativeDriver: true,
              }).start(() => navigation.goBack());
            } else {
              Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true,
              }).start();
            }
            return;
          }

          if (didLongPress.current) {
            setPaused(false);
            return;
          }

          if (heldMs < LONG_PRESS_MS) {
            const tapX = e.nativeEvent.pageX;
            if (tapX < SCREEN_W * 0.33) {
              advanceBackward();
            } else {
              advanceForward();
            }
          }
        },
        onPanResponderTerminate: () => {
          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
          }
          if (didLongPress.current) {
            setPaused(false);
          }
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [advanceForward, advanceBackward, translateY, navigation]
  );

  const handleDelete = () => {
    if (!currentStory || currentStory.user_id !== myId) return;
    Alert.alert('Delete story?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await storiesService.deleteStory(currentStory.id);
            const nextStories = stories.filter(st => st.id !== currentStory.id);
            if (nextStories.length === 0) {
              navigation.goBack();
              return;
            }
            setStories(nextStories);
            setStoryIndex(Math.min(storyIndex, nextStories.length - 1));
          } catch {
            Alert.alert('Error', 'Could not delete story');
          }
        },
      },
    ]);
  };

  const openViewersList = async () => {
    if (!currentStory) return;
    setViewersOpen(true);
    setPaused(true);
    setLoadingViewers(true);
    try {
      const list = await storiesService.getViewers(currentStory.id);
      setViewers(list);
    } catch (e) {
      console.log('[getViewers]', e);
    } finally {
      setLoadingViewers(false);
    }
  };

  const closeViewersList = () => {
    setViewersOpen(false);
    setViewers([]);
    setPaused(false);
  };

  const openViewerProfile = (userId: string) => {
    closeViewersList();
    setTimeout(() => {
      navigation.navigate('UserProfile', { userId });
    }, 300);
  };

  if (loading) {
    return (
      <View style={s.rootLoading}>
        <StatusBar hidden />
        <ActivityIndicator color="#FFFFFF" size="large" />
      </View>
    );
  }

  if (!currentStory) {
    return (
      <View style={s.rootLoading}>
        <StatusBar hidden />
        <Text style={s.emptyTxt}>No stories</Text>
      </View>
    );
  }

  const isOwn = currentStory.user_id === myId;
  const stickers = (currentStory.stickers_json || []) as StoryTextSticker[];

  return (
    <Animated.View
      style={[s.root, { transform: [{ translateY }] }]}
      {...panResponder.panHandlers}
    >
      <StatusBar hidden />

      {/* Media */}
      <View
        style={s.mediaWrap}
        pointerEvents="none"
        onLayout={e => setMediaSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {isVideo ? (
          <VideoView
            style={s.media}
            player={videoPlayer}
            contentFit="contain"
            nativeControls={false}
            onFirstFrameRender={() => setMediaReady(true)}
          />
        ) : (
          <Image
            source={{ uri: currentStory.media_url }}
            style={s.media}
            resizeMode="contain"
            onLoad={() => setMediaReady(true)}
          />
        )}

        {/* Sticker overlay */}
        <StickerOverlay
          stickers={stickers}
          containerW={mediaSize.w}
          containerH={mediaSize.h}
        />
      </View>

      {/* Header */}
      <SafeAreaView
        style={[s.header, { paddingTop: insets.top + 4 }]}
        edges={['top']}
        pointerEvents="box-none"
      >
        <View style={s.progressRow} pointerEvents="none">
          {stories.map((_, i) => {
            const isCompleted = i < storyIndex;
            const isActive = i === storyIndex;
            return (
              <View key={i} style={s.progressSegment}>
                <View style={s.progressBg} />
                <Animated.View
                  style={[
                    s.progressFg,
                    {
                      width: isCompleted
                        ? '100%'
                        : isActive
                        ? progressAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          })
                        : '0%',
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>

        <View style={s.headerInfo}>
          <View style={s.userRow}>
            {storyUser?.avatar_url ? (
              <Image source={{ uri: storyUser.avatar_url }} style={s.headerAvatar} />
            ) : (
              <View style={[s.headerAvatar, s.headerAvatarFb]}>
                <Text style={s.headerAvatarTxt}>
                  {initials(storyUser?.full_name)}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.userName} numberOfLines={1}>
                {storyUser?.full_name || 'User'}
              </Text>
              <Text style={s.timeTxt}>{timeAgo(currentStory.created_at)}</Text>
            </View>
          </View>

          <View style={s.headerActions}>
            {isOwn && (
              <>
                <TouchableOpacity onPress={openViewersList} style={s.iconBtn}>
                  <Feather name="eye" size={20} color="#FFFFFF" />
                  {currentStory.views_count > 0 && (
                    <View style={s.viewBadge}>
                      <Text style={s.viewBadgeTxt}>{currentStory.views_count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDelete} style={s.iconBtn}>
                  <Feather name="trash-2" size={18} color="#FFFFFF" />
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity onPress={() => navigation.goBack()} style={s.iconBtn}>
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {currentStory.caption ? (
        <View style={[s.captionWrap, { paddingBottom: insets.bottom + 20 }]} pointerEvents="none">
          <Text style={s.captionTxt}>{currentStory.caption}</Text>
        </View>
      ) : null}

      {paused && !viewersOpen && (
        <View pointerEvents="none" style={s.pausedHint}>
          <Feather name="pause" size={28} color="rgba(255,255,255,0.9)" />
        </View>
      )}

      <Modal
        visible={viewersOpen}
        transparent
        animationType="slide"
        onRequestClose={closeViewersList}
      >
        <TouchableOpacity
          style={s.viewersOverlay}
          activeOpacity={1}
          onPress={closeViewersList}
        >
          <TouchableOpacity activeOpacity={1} style={s.viewersSheet}>
            <View style={s.viewersHandle} />
            <View style={s.viewersHeaderRow}>
              <Feather name="eye" size={18} color="#000" />
              <Text style={s.viewersTitle}>
                {currentStory.views_count} {currentStory.views_count === 1 ? 'view' : 'views'}
              </Text>
              <TouchableOpacity onPress={closeViewersList} style={s.viewersClose}>
                <Feather name="x" size={18} color="#8E8E93" />
              </TouchableOpacity>
            </View>

            {loadingViewers ? (
              <View style={s.viewersLoader}>
                <ActivityIndicator size="small" color="#007AFF" />
              </View>
            ) : viewers.length === 0 ? (
              <View style={s.viewersEmpty}>
                <Text style={s.viewersEmptyTxt}>No views yet</Text>
              </View>
            ) : (
              <FlatList
                data={viewers}
                keyExtractor={(v) => v.user_id}
                contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={s.viewerRow}
                    activeOpacity={0.7}
                    onPress={() => openViewerProfile(item.user_id)}
                  >
                    {item.avatar_url ? (
                      <Image source={{ uri: item.avatar_url }} style={s.viewerAvatar} />
                    ) : (
                      <View style={[s.viewerAvatar, s.viewerAvatarFb]}>
                        <Text style={s.viewerAvatarTxt}>
                          {initials(item.full_name)}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={s.viewerName} numberOfLines={1}>
                        {item.full_name || 'User'}
                      </Text>
                      {item.username ? (
                        <Text style={s.viewerUsername}>@{item.username}</Text>
                      ) : null}
                    </View>
                    <Text style={s.viewerTime}>{timeAgo(item.viewed_at)}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  rootLoading: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTxt: { color: '#FFFFFF', fontSize: 15 },
  mediaWrap: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  media: {
    width: SCREEN_W,
    height: SCREEN_H,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  progressRow: {
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  progressSegment: {
    flex: 1,
    height: 3,
    position: 'relative',
  },
  progressBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 2,
  },
  progressFg: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  userRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  headerAvatarFb: {
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  timeTxt: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  viewBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewBadgeTxt: { fontSize: 9, color: '#FFF', fontWeight: '700' },
  captionWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  captionTxt: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  pausedHint: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    alignItems: 'center',
    marginTop: -14,
  },

  viewersOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  viewersSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    maxHeight: '75%',
  },
  viewersHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E0',
    alignSelf: 'center',
    marginBottom: 10,
  },
  viewersHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  viewersTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  viewersClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewersLoader: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  viewersEmpty: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  viewersEmptyTxt: { fontSize: 14, color: '#8E8E93' },
  viewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F5F5F5',
  },
  viewerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  viewerAvatarFb: {
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerAvatarTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  viewerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  viewerUsername: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  viewerTime: {
    fontSize: 12,
    color: '#8E8E93',
  },
});