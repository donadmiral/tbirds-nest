import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Dimensions, Animated,
  PanResponder, ActivityIndicator, Alert, StatusBar, Modal, FlatList,
  Platform, TextInput, Keyboard, LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  palette, surface, text as textColor, accent, border as borderColor,
  space, radius, borderRadius, typeSize, fontWeight as fw, letterSpacing as ls,
  motion, duration, spring, feedback,
} from '../../constants/tokens';
import ReAnimated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withSpring, interpolate,
  Easing as REasing, cancelAnimation, runOnJS,
} from 'react-native-reanimated';
import {
  storiesService, StoryRow, StoryViewer, StoryTextSticker,
  StoryReaction, StoryPoll, StoryPollVoter,
} from '../../services/storiesService';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import StickerOverlay from '../../components/stories/StickerOverlay';
import PollCard from '../../components/stories/PollCard';
import SaveToHighlightSheet from '../../components/stories/SaveToHighlightSheet';
import StickerResponsesSheet from '../../components/stories/StickerResponsesSheet';
import EnvironmentLayer from '../../components/stories/EnvironmentLayer';
import IdentityPresence from '../../components/stories/IdentityPresence';
import MemoryCaption from '../../components/stories/MemoryCaption';
import MemoryProgressArc from '../../components/stories/MemoryProgressArc';
import ImmersiveReplyField from '../../components/stories/ImmersiveReplyField';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const IMAGE_DURATION_MS = 5000;
const VIDEO_MAX_MS = 30000;
const LONG_PRESS_MS = 160;
const BOTTOM_CONTROLS_HEIGHT = 120;
const CROSSFADE_MS = 200;
const CROSSFADE_USER_MS = 320;
const PROGRESS_SEED = 0.02;
const DISMISS_VELOCITY_THRESHOLD = 0.5;
const DISMISS_DISTANCE_FAST = 50;
const DISMISS_DISTANCE_SLOW = 120;
const RUBBER_BAND_FACTOR = 0.3;
const TAP_SCALE_DOWN = 0.97;
const TAP_SCALE_DURATION = 90;
const TIMEOUT_PRELOADED_MS = 150;
const TIMEOUT_DEFAULT_MS = 500;
const TIMEOUT_VIDEO_MS = 800;

const NAVY = palette.navy;
const REACTION_EMOJIS = ['\u2764\uFE0F', '\uD83D\uDD25', '\uD83D\uDE02', '\uD83D\uDE2E', '\uD83D\uDE22', '\uD83D\uDC4F'];

const DUAL_BUBBLE_BASE_W = 120;
const DUAL_BUBBLE_BASE_H = 160;
const DUAL_BUBBLE_RADIUS = 28;
const SPLIT_GAP = 4;

type DualLayoutMode = 'pip_front_small' | 'pip_rear_small' | 'split_vertical' | 'split_horizontal' | 'floating_bubble';
type ParsedDualLayout = { nx: number; ny: number; scale: number; primaryCamera: 'rear' | 'front'; mode: DualLayoutMode };

type RouteParams = { userIds: string[]; startUserId: string; highlightId?: string; highlightTitle?: string };
type HoldoverMedia = { url: string; type: 'image' | 'video'; transform: { scale: number; translateNX: number; translateNY: number; fit: 'cover' | 'contain' } | null } | null;

type EngagementState = { responses: Record<string, any>; counts: Record<string, number>; averages: Record<string, number>; quizCounts: Record<string, Record<string, number>> };
type EngagementAction = | { type: 'RESET' } | { type: 'LOADED'; responses: Record<string, any>; counts: Record<string, number>; averages: Record<string, number>; quizCounts: Record<string, Record<string, number>> } | { type: 'SET_RESPONSE'; stickerId: string; value: any };
const engagementInitial: EngagementState = { responses: {}, counts: {}, averages: {}, quizCounts: {} };
function engagementReducer(state: EngagementState, action: EngagementAction): EngagementState {
  switch (action.type) {
    case 'RESET': return engagementInitial;
    case 'LOADED': return { responses: action.responses, counts: action.counts, averages: action.averages, quizCounts: action.quizCounts };
    case 'SET_RESPONSE': return { ...state, responses: { ...state.responses, [action.stickerId]: action.value } };
    default: return state;
  }
}

type ResponsesSheetState = { open: boolean; stickerId: string; type: 'question' | 'slider' | 'quiz'; title: string; quizOptions: any[] | undefined };
type ResponsesSheetAction = | { type: 'OPEN'; stickerId: string; responseType: 'question' | 'slider' | 'quiz'; title: string; quizOptions?: any[] } | { type: 'CLOSE' };
const responsesSheetInitial: ResponsesSheetState = { open: false, stickerId: '', type: 'question', title: '', quizOptions: undefined };
function responsesSheetReducer(state: ResponsesSheetState, action: ResponsesSheetAction): ResponsesSheetState {
  switch (action.type) {
    case 'OPEN': return { open: true, stickerId: action.stickerId, type: action.responseType, title: action.title, quizOptions: action.quizOptions };
    case 'CLOSE': return { ...state, open: false };
    default: return state;
  }
}

let lastViewerPosition: { sessionKey: string; userIndex: number; storyIndex: number; timestamp: number } | null = null;

function initials(name?: string | null) { if (!name) return 'U'; const p = name.trim().split(' ').filter(Boolean); return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase(); }

function timeAgo(iso?: string | null): string { if (!iso) return ''; const diff = Date.now() - new Date(iso).getTime(); const m = Math.floor(diff / 60000); const h = Math.floor(m / 60); if (m < 1) return 'Just now'; if (m < 60) return `${m}m ago`; if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`; }

function parseMediaTransform(raw: any): { scale: number; translateNX: number; translateNY: number; fit: 'cover' | 'contain' } | null {
  if (!raw || typeof raw !== 'object') return null;
  const scale = typeof raw.scale === 'number' ? raw.scale : null;
  const translateNX = typeof raw.translateNX === 'number' ? raw.translateNX : null;
  const translateNY = typeof raw.translateNY === 'number' ? raw.translateNY : null;
  const fit = (raw.fit === 'cover' || raw.fit === 'contain') ? raw.fit : null;
  if (scale === null && translateNX === null && translateNY === null && fit === null) return null;
  return { scale: scale ?? 1, translateNX: translateNX ?? 0, translateNY: translateNY ?? 0, fit: fit ?? 'contain' };
}

function parseDualLayout(raw: any): ParsedDualLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const bubble = raw.bubble ?? raw.bubblePosition;
  
  const nx = typeof bubble?.nx === 'number' ? bubble.nx : (typeof bubble?.x === 'number' && SCREEN_W > 0 ? bubble.x / SCREEN_W : 0.05);
  const ny = typeof bubble?.ny === 'number' ? bubble.ny : (typeof bubble?.y === 'number' && SCREEN_H > 0 ? bubble.y / SCREEN_H : 0.06);
  
  const validModes: DualLayoutMode[] = ['pip_front_small', 'pip_rear_small', 'split_vertical', 'split_horizontal', 'floating_bubble'];
  const mode: DualLayoutMode = validModes.includes(raw.mode) ? raw.mode : 'pip_front_small';
  const primaryCamera = raw.primaryCamera === 'front' ? 'front' : 'rear';
  return { nx, ny, scale: typeof bubble?.scale === 'number' ? bubble.scale : 1, primaryCamera, mode };
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
  const sessionKey = useMemo(() => userIds.join('|'), [userIds]);

  const resumePosition = useMemo(() => {
    if (lastViewerPosition && lastViewerPosition.sessionKey === sessionKey && Date.now() - lastViewerPosition.timestamp < 5 * 60 * 1000) return { userIndex: lastViewerPosition.userIndex, storyIndex: lastViewerPosition.storyIndex };
    return null;
  }, [sessionKey]);
  const initialUserIndex = useMemo(() => { if (resumePosition) return resumePosition.userIndex; const idx = userIds.indexOf(startUserId); return idx >= 0 ? idx : 0; }, [userIds, startUserId, resumePosition]);
  const resumeStoryIndex = resumePosition?.storyIndex ?? -1;
  const resumeConsumedRef = useRef(false);

  const [userIndex, setUserIndex] = useState(initialUserIndex);
  const currentUserId = userIds[userIndex];
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [storyIndex, setStoryIndex] = useState(0);
  const [storyUser, setStoryUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [mediaSize, setMediaSize] = useState({ w: SCREEN_W, h: SCREEN_H });

  const [holdoverMedia, setHoldoverMedia] = useState<HoldoverMedia>(null);
  const mediaOpacitySV = useSharedValue(1);
  const mediaReadyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdoverCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstStoryRef = useRef(true);
  const progressStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storiesViewedRef = useRef(0);
  const lastTapTimestampRef = useRef(0);
  const isUserSwitchRef = useRef(false);
  const activeMediaAnimStyle = useAnimatedStyle(() => ({ opacity: mediaOpacitySV.value }));
  const tappableStickerRectsRef = useRef<{ left: number; right: number; top: number; bottom: number }[]>([]);

  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewers, setViewers] = useState<StoryViewer[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const myReactionsRef = useRef<Set<string>>(new Set());
  const [reactionToast, setReactionToast] = useState<string | null>(null);
  const [viewerReactions, setViewerReactions] = useState<Map<string, string[]>>(new Map());
  const [reactionsCount, setReactionsCount] = useState(0);
  const reactionBusyRef = useRef<Set<string>>(new Set());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [replyMode, setReplyMode] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [replyToast, setReplyToast] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const replyInputRef = useRef<TextInput>(null);
  const replyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [poll, setPoll] = useState<StoryPoll | null>(null);
  const pollRef = useRef<StoryPoll | null>(null);
  const [votingOptionId, setVotingOptionId] = useState<string | null>(null);
  const [pollVotersOpen, setPollVotersOpen] = useState(false);
  const [pollVotersOptionId, setPollVotersOptionId] = useState<string | null>(null);
  const [pollVoters, setPollVoters] = useState<StoryPollVoter[]>([]);
  const [loadingPollVoters, setLoadingPollVoters] = useState(false);
  const pollLayoutRef = useRef<{ top: number; bottom: number; left: number; right: number } | null>(null);
  useEffect(() => { pollRef.current = poll; }, [poll]);

  const [highlightSheetOpen, setHighlightSheetOpen] = useState(false);
  const highlightId = params?.highlightId;
  const highlightTitle = params?.highlightTitle;
  const [engagement, dispatchEngagement] = useReducer(engagementReducer, engagementInitial);
  const [responsesSheet, dispatchResponsesSheet] = useReducer(responsesSheetReducer, responsesSheetInitial);

  const pauseStackRef = useRef<Set<string>>(new Set());
  const pauseFor = useCallback((reason: string) => { pauseStackRef.current.add(reason); setPaused(true); if (reason !== 'longPress') { dimChromeForEngagement(); } }, [dimChromeForEngagement]);
  const resumeFrom = useCallback((reason: string) => { pauseStackRef.current.delete(reason); if (pauseStackRef.current.size === 0) { setPaused(false); restoreChrome(); startChromeIdle(); } }, [restoreChrome, startChromeIdle]);

  const [caughtUp, setCaughtUp] = useState(false);
  const caughtUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentScale = useRef(new Animated.Value(1)).current;
  const tapScaleSV = useSharedValue(1);
  const tapScaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: tapScaleSV.value }] }));
  const caughtUpOpacitySV = useSharedValue(0);
  const caughtUpAnimStyle = useAnimatedStyle(() => ({ opacity: caughtUpOpacitySV.value }));
  const pickerOpacitySV = useSharedValue(0);
  const pickerScaleSV = useSharedValue(0.92);

  const chromeOpacity = useSharedValue(1);
  const chromeIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CHROME_IDLE_MS = 2200;
  const CHROME_FOCUS_LEVEL = 0.65;
  const CHROME_ENGAGE_LEVEL = 0.45;

  const startChromeIdle = useCallback(() => { if (chromeIdleTimer.current) clearTimeout(chromeIdleTimer.current); if (pauseStackRef.current.size > 0) return; chromeIdleTimer.current = setTimeout(() => { chromeOpacity.value = withTiming(CHROME_FOCUS_LEVEL, { duration: 1400, easing: REasing.out(REasing.ease) }); }, CHROME_IDLE_MS); }, []);
  const restoreChrome = useCallback(() => { if (chromeIdleTimer.current) { clearTimeout(chromeIdleTimer.current); chromeIdleTimer.current = null; } chromeOpacity.value = withTiming(1, { duration: 400, easing: REasing.out(REasing.ease) }); }, []);
  const dimChromeForEngagement = useCallback(() => { if (chromeIdleTimer.current) { clearTimeout(chromeIdleTimer.current); chromeIdleTimer.current = null; } chromeOpacity.value = withTiming(CHROME_ENGAGE_LEVEL, { duration: 360, easing: REasing.out(REasing.ease) }); }, []);
  const headerChromeStyle = useAnimatedStyle(() => ({ opacity: Math.max(0.55, chromeOpacity.value) }));
  const bottomChromeStyle = useAnimatedStyle(() => ({ opacity: Math.max(0.6, Math.min(1, chromeOpacity.value * 1.1)) }));
  const progressChromeStyle = useAnimatedStyle(() => ({ opacity: Math.max(0.4, chromeOpacity.value * 0.85) }));
  const pickerAnimStyle = useAnimatedStyle(() => ({ opacity: pickerOpacitySV.value, transform: [{ scale: pickerScaleSV.value }] }));

  const nextUserCache = useRef<Map<string, { stories: StoryRow[]; profile: any }>>(new Map());
  const preloadStatus = useRef<Map<string, 'pending' | 'done' | 'failed'>>(new Map());

  // Dual viewer swap state (viewer-only, does not persist)
  const [dualSwapped, setDualSwapped] = useState(false);
  const dualSwapOpacity = useSharedValue(1);
  const dualSwapAnimStyle = useAnimatedStyle(() => ({ opacity: dualSwapOpacity.value }));
  const bubbleEntryScale = useSharedValue(0);
  const bubbleEntryAnimStyle = useAnimatedStyle(() => ({ transform: [{ scale: bubbleEntryScale.value }] }));
  useEffect(() => { setDualSwapped(false); dualSwapOpacity.value = 1; bubbleEntryScale.value = 0; }, [storyIndex, userIndex]);
  useEffect(() => { if (hasDual && mediaReady) { bubbleEntryScale.value = withSpring(1, { damping: 14, stiffness: 160, mass: 1.0 }); } }, [hasDual, mediaReady]);
  const handleDualSwapTap = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    dualSwapOpacity.value = withSequence(withTiming(0, { duration: 120 }), withTiming(1, { duration: 180, easing: REasing.out(REasing.cubic) }));
    setTimeout(() => setDualSwapped(prev => !prev), 120);
  }, [dualSwapOpacity]);

  useEffect(() => { return () => { nextUserCache.current.clear(); if (mediaReadyTimeoutRef.current) clearTimeout(mediaReadyTimeoutRef.current); if (holdoverCleanupRef.current) clearTimeout(holdoverCleanupRef.current); if (replyFocusTimerRef.current) clearTimeout(replyFocusTimerRef.current); if (progressStartTimerRef.current) clearTimeout(progressStartTimerRef.current); }; }, []);
  useEffect(() => { const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'; const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'; const showSub = Keyboard.addListener(showEvent, (e) => { setKeyboardHeight(e.endCoordinates.height); }); const hideSub = Keyboard.addListener(hideEvent, () => { setKeyboardHeight(0); }); return () => { showSub.remove(); hideSub.remove(); }; }, []);
  useEffect(() => { myReactionsRef.current = myReactions; }, [myReactions]);

  const progressSV = useSharedValue(0);
  const microParallaxStyle = useAnimatedStyle(() => {
    const s = interpolate(progressSV.value, [0, 1], [1.02, 1.0]);
    return { transform: [{ scale: s }] };
  });
  const progressDurationRef = useRef(IMAGE_DURATION_MS);
  const translateY = useRef(new Animated.Value(0)).current;
  const storiesRef = useRef<StoryRow[]>([]);
  const storyIndexRef = useRef(0);
  const userIndexRef = useRef(initialUserIndex);
  useEffect(() => { storiesRef.current = stories; }, [stories]);
  useEffect(() => { storyIndexRef.current = storyIndex; }, [storyIndex]);
  useEffect(() => { userIndexRef.current = userIndex; }, [userIndex]);

  const currentStory = stories[storyIndex];
  const isVideo = currentStory?.media_type === 'video';
  const isText = currentStory?.media_type === 'text';
  const videoPlayer = useVideoPlayer(isVideo && !isText && currentStory ? currentStory.media_url : null, (player) => { if (player) { player.loop = false; player.muted = false; } });

  const captureHoldover = useCallback(() => { const cur = storiesRef.current[storyIndexRef.current]; if (!cur || !cur.media_url) { setHoldoverMedia(null); return; } setHoldoverMedia({ url: cur.media_url, type: cur.media_type === 'video' ? 'video' : 'image', transform: parseMediaTransform((cur as any).media_transform) }); }, []);
  const prepareCrossfade = useCallback(() => { cancelAnimation(mediaOpacitySV); if (holdoverCleanupRef.current) { clearTimeout(holdoverCleanupRef.current); holdoverCleanupRef.current = null; } if (mediaReadyTimeoutRef.current) { clearTimeout(mediaReadyTimeoutRef.current); mediaReadyTimeoutRef.current = null; } mediaOpacitySV.value = 0; }, [mediaOpacitySV]);
  const executeCrossfade = useCallback(() => { const tapInterval = Date.now() - lastTapTimestampRef.current; const isRapid = tapInterval < 800; const baseDuration = isUserSwitchRef.current ? CROSSFADE_USER_MS : CROSSFADE_MS; const fadeDuration = isRapid ? 100 : baseDuration; cancelAnimation(mediaOpacitySV); mediaOpacitySV.value = withTiming(1, { duration: fadeDuration, easing: REasing.out(REasing.ease) }); if (holdoverCleanupRef.current) clearTimeout(holdoverCleanupRef.current); holdoverCleanupRef.current = setTimeout(() => { setHoldoverMedia(null); holdoverCleanupRef.current = null; }, fadeDuration + 50); }, [mediaOpacitySV]);

  const stopProgress = useCallback(() => { cancelAnimation(progressSV); }, [progressSV]);
  const resetProgress = useCallback(() => { cancelAnimation(progressSV); progressSV.value = 0; }, [progressSV]);
  const saveAndGoBack = useCallback(() => { lastViewerPosition = { sessionKey, userIndex: userIndexRef.current, storyIndex: storyIndexRef.current, timestamp: Date.now() }; navigation.goBack(); }, [sessionKey, navigation]);
  const fireTapFeedback = useCallback(() => { cancelAnimation(tapScaleSV); tapScaleSV.value = withSequence(withTiming(TAP_SCALE_DOWN, { duration: TAP_SCALE_DURATION, easing: REasing.out(REasing.ease) }), withTiming(1, { duration: TAP_SCALE_DURATION, easing: REasing.in(REasing.ease) })); }, [tapScaleSV]);

  const advanceForward = useCallback(() => {
    lastTapTimestampRef.current = Date.now(); captureHoldover(); prepareCrossfade(); resetProgress(); storiesViewedRef.current += 1;
    const curStories = storiesRef.current; const curStoryIdx = storyIndexRef.current; const curUserIdx = userIndexRef.current;
    if (curStoryIdx < curStories.length - 1) { isUserSwitchRef.current = false; progressSV.value = PROGRESS_SEED; const next = curStoryIdx + 1; storyIndexRef.current = next; setStoryIndex(next); }
    else if (curUserIdx < userIds.length - 1) { isUserSwitchRef.current = true; contentScale.setValue(0.96); Animated.spring(contentScale, { toValue: 1, tension: 60, friction: 10, useNativeDriver: true }).start(); progressSV.value = PROGRESS_SEED; const next = curUserIdx + 1; userIndexRef.current = next; setUserIndex(next); }
    else { if (highlightId) { saveAndGoBack(); } else { setCaughtUp(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); caughtUpOpacitySV.value = 0; caughtUpOpacitySV.value = withTiming(1, { duration: 700, easing: REasing.out(REasing.ease) }); const viewed = storiesViewedRef.current; const lingerMs = viewed <= 3 ? 2500 : viewed <= 8 ? 3500 : 4500; caughtUpTimer.current = setTimeout(() => saveAndGoBack(), lingerMs); } }
  }, [resetProgress, userIds.length, saveAndGoBack, contentScale, highlightId, captureHoldover, prepareCrossfade, progressSV, caughtUpOpacitySV]);

  const advanceBackward = useCallback(() => {
    lastTapTimestampRef.current = Date.now(); captureHoldover(); prepareCrossfade(); resetProgress();
    const curStoryIdx = storyIndexRef.current; const curUserIdx = userIndexRef.current;
    if (curStoryIdx > 0) { isUserSwitchRef.current = false; progressSV.value = PROGRESS_SEED; const next = curStoryIdx - 1; storyIndexRef.current = next; setStoryIndex(next); }
    else if (curUserIdx > 0) { isUserSwitchRef.current = true; contentScale.setValue(0.96); Animated.spring(contentScale, { toValue: 1, tension: 60, friction: 10, useNativeDriver: true }).start(); progressSV.value = PROGRESS_SEED; const next = curUserIdx - 1; userIndexRef.current = next; setUserIndex(next); }
  }, [resetProgress, contentScale, captureHoldover, prepareCrossfade, progressSV]);

  const startProgress = useCallback((durationMs: number, fromValue = 0) => { cancelAnimation(progressSV); progressDurationRef.current = durationMs; const effectiveFrom = Math.max(fromValue, PROGRESS_SEED); const remainingMs = durationMs * (1 - effectiveFrom); progressSV.value = effectiveFrom; progressSV.value = withTiming(1, { duration: remainingMs, easing: REasing.linear }, (finished) => { if (finished) { runOnJS(advanceForward)(); } }); }, [progressSV, advanceForward]);

  const loadForCurrentUser = useCallback(async () => {
    if (!currentUserId) return; setMediaReady(false);
    if (highlightId) { setLoading(true); try { const [hlStories, profileRes] = await Promise.all([storiesService.getHighlightStories(highlightId), supabase.from('profiles').select('id, full_name, username, avatar_url').eq('id', currentUserId).maybeSingle()]); setStories(hlStories); setStoryUser(profileRes.data || null); setStoryIndex(0); } catch (e) { console.log('[StoryViewer.loadHighlight]', e); setStories([]); } finally { setLoading(false); } return; }
    const cached = nextUserCache.current.get(currentUserId);
    if (cached) { nextUserCache.current.delete(currentUserId); setStories(cached.stories); setStoryUser(cached.profile); if (!resumeConsumedRef.current && resumeStoryIndex >= 0 && resumeStoryIndex < cached.stories.length) { setStoryIndex(resumeStoryIndex); resumeConsumedRef.current = true; } else { const firstUnseen = cached.stories.findIndex(s => !s.is_viewed); setStoryIndex(firstUnseen >= 0 ? firstUnseen : 0); } setLoading(false); return; }
    setLoading(true);
    try { const [userStories, profileRes] = await Promise.all([storiesService.getUserStories(currentUserId), supabase.from('profiles').select('id, full_name, username, avatar_url').eq('id', currentUserId).maybeSingle()]); setStories(userStories); setStoryUser(profileRes.data || null); if (!resumeConsumedRef.current && resumeStoryIndex >= 0 && resumeStoryIndex < userStories.length) { setStoryIndex(resumeStoryIndex); resumeConsumedRef.current = true; } else { const firstUnseen = userStories.findIndex(s => !s.is_viewed); setStoryIndex(firstUnseen >= 0 ? firstUnseen : 0); } } catch (e) { console.log('[StoryViewer.load]', e); setStories([]); } finally { setLoading(false); }
  }, [currentUserId]);
  useEffect(() => { loadForCurrentUser(); }, [loadForCurrentUser]);

  useEffect(() => { let cancelled = false; const preloadUser = async (userId: string) => { if (!userId || nextUserCache.current.has(userId)) return; try { const [userStories, profileRes] = await Promise.all([storiesService.getUserStories(userId), supabase.from('profiles').select('id, full_name, username, avatar_url').eq('id', userId).maybeSingle()]); if (cancelled) return; if (nextUserCache.current.size >= 3) { const firstKey = nextUserCache.current.keys().next().value; if (firstKey) nextUserCache.current.delete(firstKey); } nextUserCache.current.set(userId, { stories: userStories, profile: profileRes.data || null }); if (userStories.length > 0) { const first = userStories[0]; if (first.media_type === 'image' && first.media_url) { preloadStatus.current.set(first.media_url, 'pending'); Image.prefetch(first.media_url).then(() => { if (!cancelled) preloadStatus.current.set(first.media_url, 'done'); }).catch(() => { if (!cancelled) preloadStatus.current.set(first.media_url, 'failed'); }); } } } catch (e) { console.log('[StoryViewer.preloadUser]', e); } }; const n1Id = userIds[userIndex + 1]; const n2Id = userIds[userIndex + 2]; (async () => { if (n1Id) await preloadUser(n1Id); if (cancelled) return; if (n2Id) await preloadUser(n2Id); })(); return () => { cancelled = true; }; }, [userIndex, userIds]);

  useEffect(() => { const prefetchStory = (story: StoryRow | undefined) => { if (story && story.media_type === 'image' && story.media_url) { const url = story.media_url; if (preloadStatus.current.get(url) === 'done') return; preloadStatus.current.set(url, 'pending'); Image.prefetch(url).then(() => { preloadStatus.current.set(url, 'done'); }).catch(() => { preloadStatus.current.set(url, 'failed'); }); } }; prefetchStory(stories[storyIndex + 1]); prefetchStory(stories[storyIndex + 2]); }, [storyIndex, stories]);

  useEffect(() => { setPickerOpen(false); setReactionToast(null); setReplyMode(false); setReplyText(''); setPoll(null); pollLayoutRef.current = null; reactionBusyRef.current = new Set(); pauseStackRef.current.clear(); chromeOpacity.value = 1; if (chromeIdleTimer.current) { clearTimeout(chromeIdleTimer.current); chromeIdleTimer.current = null; } startChromeIdle(); if (!currentStory || !myId || currentStory.user_id === myId) { const empty = new Set<string>(); setMyReactions(empty); myReactionsRef.current = empty; return; } let cancelled = false; storiesService.getMyReactions(currentStory.id).then(emojis => { if (!cancelled) { const loaded = new Set(emojis); setMyReactions(loaded); myReactionsRef.current = loaded; } }); return () => { cancelled = true; }; }, [currentStory?.id, myId]);

  useEffect(() => { if (!currentStory) return; let cancelled = false; storiesService.getStoryPoll(currentStory.id).then(data => { if (!cancelled) setPoll(data); }).catch((e) => { console.log('[StoryPoll.load]', e); }); return () => { cancelled = true; }; }, [currentStory?.id]);

  useEffect(() => { if (!currentStory) return; const stickerList = (currentStory.stickers_json || []) as StoryTextSticker[]; const engagementStickers = stickerList.filter(s => s.kind === 'question' || s.kind === 'slider' || s.kind === 'quiz'); if (engagementStickers.length === 0) { dispatchEngagement({ type: 'RESET' }); return; } let cancelled = false; const isOwnStory = currentStory.user_id === myId; (async () => { try { const myResps: Record<string, any> = {}; const counts: Record<string, number> = {}; const avgs: Record<string, number> = {}; const quizCounts: Record<string, Record<string, number>> = {}; const promises = engagementStickers.flatMap(st => { const tasks: Promise<void>[] = []; if (isOwnStory) { tasks.push(storiesService.getStickerResponses(currentStory.id, st.id).then(all => { if (cancelled) return; counts[st.id] = all.length; if (st.kind === 'slider') { const vals = all.filter(r => r.number_value != null).map(r => r.number_value as number); avgs[st.id] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0; } if (st.kind === 'quiz') { const optCounts: Record<string, number> = {}; all.forEach(r => { if (r.option_id) optCounts[r.option_id] = (optCounts[r.option_id] || 0) + 1; }); quizCounts[st.id] = optCounts; } })); } else { tasks.push(storiesService.getMyStickerResponse(currentStory.id, st.id).then(my => { if (cancelled) return; if (my) myResps[st.id] = my; })); if (st.kind === 'slider' || st.kind === 'quiz') { tasks.push(storiesService.getStickerResponses(currentStory.id, st.id).then(all => { if (cancelled) return; counts[st.id] = all.length; if (st.kind === 'slider') { const vals = all.filter(r => r.number_value != null).map(r => r.number_value as number); avgs[st.id] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0; } if (st.kind === 'quiz') { const optCounts: Record<string, number> = {}; all.forEach(r => { if (r.option_id) optCounts[r.option_id] = (optCounts[r.option_id] || 0) + 1; }); quizCounts[st.id] = optCounts; } })); } } return tasks; }); await Promise.all(promises); if (cancelled) return; dispatchEngagement({ type: 'LOADED', responses: myResps, counts, averages: avgs, quizCounts }); } catch (e) { console.log('[StoryViewer.engagementLoad]', e); } })(); return () => { cancelled = true; }; }, [currentStory?.id, myId]);

  useEffect(() => { if (!currentStory) return; if (myId && currentStory.user_id !== myId) { storiesService.markViewed(currentStory.id); } }, [currentStory?.id, myId]);
  useEffect(() => { const stickerList = (currentStory?.stickers_json || []) as StoryTextSticker[]; const PILL_W = 150; const PILL_H = 36; const rects = stickerList.filter(s => s.kind === 'link' || s.kind === 'location' || s.kind === 'mention').map(s => { const cx = s.nx * mediaSize.w; const cy = s.ny * mediaSize.h; const hw = (PILL_W * s.scale) / 2; const hh = (PILL_H * s.scale) / 2; return { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh }; }); tappableStickerRectsRef.current = rects; }, [currentStory?.stickers_json, mediaSize]);

  useEffect(() => { if (!currentStory) return; if (!mediaReady) return; if (mediaReadyTimeoutRef.current) { clearTimeout(mediaReadyTimeoutRef.current); mediaReadyTimeoutRef.current = null; } const isFirstStory = isFirstStoryRef.current; if (isFirstStoryRef.current) { isFirstStoryRef.current = false; mediaOpacitySV.value = 1; setHoldoverMedia(null); } else { executeCrossfade(); } if (paused) { stopProgress(); if (isVideo && videoPlayer) { try { videoPlayer.pause(); } catch {} } return; } let durationMs: number; if (isVideo) { const d = currentStory.duration_sec ? currentStory.duration_sec * 1000 : VIDEO_MAX_MS; durationMs = Math.min(d, VIDEO_MAX_MS); if (videoPlayer) { try { videoPlayer.play(); } catch {} } } else { durationMs = IMAGE_DURATION_MS; if (currentStory.caption) { const readingMs = Math.ceil(currentStory.caption.length / 20) * 1000; durationMs = Math.min(durationMs + readingMs, 8000); } } const tapInterval = Date.now() - lastTapTimestampRef.current; const isRapid = tapInterval < 800; const progressDelay = isFirstStory ? 0 : (isRapid ? 50 : 100); if (progressStartTimerRef.current) clearTimeout(progressStartTimerRef.current); if (progressDelay > 0) { progressStartTimerRef.current = setTimeout(() => { startProgress(durationMs, progressSV.value); progressStartTimerRef.current = null; }, progressDelay); } else { startProgress(durationMs, progressSV.value); } return () => { stopProgress(); if (progressStartTimerRef.current) { clearTimeout(progressStartTimerRef.current); progressStartTimerRef.current = null; } }; }, [mediaReady, paused, currentStory, isVideo, videoPlayer, startProgress, stopProgress, executeCrossfade, mediaOpacitySV, progressSV]);

  useEffect(() => { setMediaReady(false); setMediaError(false); if (progressSV.value < PROGRESS_SEED) { progressSV.value = PROGRESS_SEED; } if (mediaReadyTimeoutRef.current) clearTimeout(mediaReadyTimeoutRef.current); const cur = storiesRef.current[storyIndexRef.current]; if (cur && cur.media_type === 'text') { setMediaReady(true); return; } let timeoutMs = TIMEOUT_DEFAULT_MS; if (cur) { if (cur.media_type === 'video') { timeoutMs = TIMEOUT_VIDEO_MS; } else if (cur.media_url && preloadStatus.current.get(cur.media_url) === 'done') { timeoutMs = TIMEOUT_PRELOADED_MS; } } mediaReadyTimeoutRef.current = setTimeout(() => { setMediaReady(prev => { if (!prev) return true; return prev; }); mediaReadyTimeoutRef.current = null; }, timeoutMs); }, [storyIndex, userIndex, progressSV]);

  const pressStartTimestamp = useRef(0); const pressStartX = useRef(0); const longPressTimer = useRef<any>(null); const didLongPress = useRef(false); const didSwipe = useRef(false); const lastTapTime = useRef(0);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (e) => { const touchY = e.nativeEvent.pageY; const touchX = e.nativeEvent.pageX; if (touchY > SCREEN_H - BOTTOM_CONTROLS_HEIGHT - insets.bottom) return false; const pl = pollLayoutRef.current; const currentPoll = pollRef.current; if (pl && touchX >= pl.left && touchX <= pl.right && touchY >= pl.top && touchY <= pl.bottom) return false; if (!pl && currentPoll) { const estTop = Math.max(insets.top + 90, Math.min(currentPoll.ny * SCREEN_H - 100, SCREEN_H - 360)); const estLeft = (currentPoll.nx * SCREEN_W) - (SCREEN_W * 0.4); if (touchX >= estLeft && touchX <= estLeft + SCREEN_W * 0.8 && touchY >= estTop && touchY <= estTop + 260) return false; } const stickerRects = tappableStickerRectsRef.current; for (let i = 0; i < stickerRects.length; i++) { const r = stickerRects[i]; if (touchX >= r.left && touchX <= r.right && touchY >= r.top && touchY <= r.bottom) return false; } return true; },
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 10 || Math.abs(g.dx) > 10,
    onPanResponderGrant: (e) => { pressStartTimestamp.current = Date.now(); pressStartX.current = e.nativeEvent.pageX; didLongPress.current = false; didSwipe.current = false; restoreChrome(); if (longPressTimer.current) clearTimeout(longPressTimer.current); longPressTimer.current = setTimeout(() => { didLongPress.current = true; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); pauseFor('longPress'); }, LONG_PRESS_MS); },
    onPanResponderMove: (_e, g) => { if ((g.dy > 3 || g.dy < -3) && Math.abs(g.dy) > Math.abs(g.dx)) { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } didSwipe.current = true; if (g.dy > 0) { translateY.setValue(g.dy); } else { translateY.setValue(g.dy * RUBBER_BAND_FACTOR); } } },
    onPanResponderRelease: (e, g) => { const heldMs = Date.now() - pressStartTimestamp.current; if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } if (didSwipe.current) { if (didLongPress.current) { resumeFrom('longPress'); didLongPress.current = false; } const shouldDismiss = g.dy > DISMISS_DISTANCE_SLOW || (g.dy > DISMISS_DISTANCE_FAST && g.vy > DISMISS_VELOCITY_THRESHOLD); if (shouldDismiss) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); Animated.timing(translateY, { toValue: SCREEN_H, duration: 220, useNativeDriver: true }).start(() => saveAndGoBack()); } else { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Animated.spring(translateY, { toValue: 0, tension: 65, friction: 7, useNativeDriver: true }).start(); } return; } if (didLongPress.current) { resumeFrom('longPress'); return; } if (heldMs < LONG_PRESS_MS) { const now = Date.now(); if (now - lastTapTime.current < 120) return; lastTapTime.current = now; fireTapFeedback(); Haptics.selectionAsync(); const tapX = e.nativeEvent.pageX; if (tapX < SCREEN_W * 0.33) { advanceBackward(); } else { advanceForward(); } startChromeIdle(); } },
    onPanResponderTerminate: () => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } if (didLongPress.current) { resumeFrom('longPress'); } Animated.spring(translateY, { toValue: 0, tension: 65, friction: 7, useNativeDriver: true }).start(); },
  }), [advanceForward, advanceBackward, translateY, navigation, insets.bottom, insets.top, pauseFor, resumeFrom, fireTapFeedback, saveAndGoBack, restoreChrome, startChromeIdle]);

  const handleDelete = () => { if (!currentStory || currentStory.user_id !== myId) return; Alert.alert('Delete story?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await storiesService.deleteStory(currentStory.id); const nextStories = stories.filter(st => st.id !== currentStory.id); if (nextStories.length === 0) { saveAndGoBack(); return; } setStories(nextStories); setStoryIndex(Math.min(storyIndex, nextStories.length - 1)); } catch { Alert.alert('Error', 'Could not delete story'); } } }]); };

  const handleReaction = useCallback(async (emoji: string) => { if (!currentStory || !myId) return; if (reactionBusyRef.current.has(emoji)) return; reactionBusyRef.current.add(emoji); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); const wasReacted = myReactionsRef.current.has(emoji); const optimistic = new Set(myReactionsRef.current); if (wasReacted) { optimistic.delete(emoji); } else { optimistic.add(emoji); } setMyReactions(optimistic); myReactionsRef.current = optimistic; if (!wasReacted) { setReactionToast(emoji); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setReactionToast(null), 2000); } try { const result = await storiesService.toggleReaction(currentStory.id, emoji); const synced = new Set(myReactionsRef.current); if (result.reacted) { synced.add(emoji); } else { synced.delete(emoji); } setMyReactions(synced); myReactionsRef.current = synced; } catch { const rollback = new Set(myReactionsRef.current); if (wasReacted) { rollback.add(emoji); } else { rollback.delete(emoji); } setMyReactions(rollback); myReactionsRef.current = rollback; } finally { reactionBusyRef.current.delete(emoji); } }, [currentStory, myId]);
  const handleHeartTap = useCallback(() => { handleReaction('\u2764\uFE0F'); }, [handleReaction]);

  const openPicker = useCallback(() => { if (replyMode) closeReplyInput(); pauseFor('picker'); Haptics.selectionAsync(); pickerOpacitySV.value = 0; pickerScaleSV.value = 0.92; setPickerOpen(true); pickerOpacitySV.value = withTiming(1, { duration: 180, easing: REasing.out(REasing.ease) }); pickerScaleSV.value = withTiming(1, { duration: 180, easing: REasing.out(REasing.ease) }); }, [replyMode, closeReplyInput, pauseFor, pickerOpacitySV, pickerScaleSV]);
  const closePicker = useCallback(() => { resumeFrom('picker'); pickerOpacitySV.value = withTiming(0, { duration: 120, easing: REasing.in(REasing.ease) }); pickerScaleSV.value = withTiming(0.92, { duration: 120, easing: REasing.in(REasing.ease) }); setTimeout(() => { setPickerOpen(false); }, 130); }, [resumeFrom, pickerOpacitySV, pickerScaleSV]);
  const handlePickerEmoji = useCallback((emoji: string) => { closePicker(); handleReaction(emoji); }, [closePicker, handleReaction]);
  useEffect(() => { if (pickerOpen) { setPickerOpen(false); resumeFrom('picker'); } }, [storyIndex, userIndex]);

  const openReplyInput = useCallback(() => { pauseFor('reply'); setReplyMode(true); if (replyFocusTimerRef.current) clearTimeout(replyFocusTimerRef.current); replyFocusTimerRef.current = setTimeout(() => replyInputRef.current?.focus(), 50); }, [pauseFor]);
  const closeReplyInput = useCallback(() => { Keyboard.dismiss(); setReplyMode(false); setReplyText(''); resumeFrom('reply'); }, [resumeFrom]);

  const sendReply = useCallback(async () => { if (!currentStory || !myId) return; const storyOwnerId = currentStory.user_id; const trimmed = replyText.trim(); if (!trimmed || sendingReply) return; setSendingReply(true); try { const sorted = [myId, storyOwnerId].sort(); const messageText = `Replied to your story:\n${trimmed}`; const { data: existing, error: findErr } = await supabase.from('conversations').select('id').or(`and(user_1.eq.${myId},user_2.eq.${storyOwnerId}),and(user_1.eq.${storyOwnerId},user_2.eq.${myId})`).eq('type', 'direct').eq('is_group', false).maybeSingle(); if (findErr) { Alert.alert('Error', 'Could not find conversation.'); setSendingReply(false); return; } let convId: string; if (existing) { convId = existing.id; } else { const { data: created, error: createErr } = await supabase.from('conversations').insert({ user_1: sorted[0], user_2: sorted[1], type: 'direct', is_group: false, last_message: '', last_message_time: new Date().toISOString() }).select('id').single(); if (createErr || !created) { Alert.alert('Error', 'Could not create conversation.'); setSendingReply(false); return; } convId = created.id; } const { error: msgErr } = await supabase.from('messages').insert({ conversation_id: convId, sender_id: myId, receiver_id: storyOwnerId, text: messageText }); if (msgErr) { Alert.alert('Error', 'Could not send reply.'); setSendingReply(false); return; } try { await supabase.from('conversations').update({ last_message: messageText, last_message_time: new Date().toISOString() }).eq('id', convId); } catch {} setReplyText(''); setReplyMode(false); Keyboard.dismiss(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setReplyToast(true); if (replyToastTimer.current) clearTimeout(replyToastTimer.current); replyToastTimer.current = setTimeout(() => setReplyToast(false), 2000); resumeFrom('reply'); } catch (e) { console.log('[sendReply]', e); Alert.alert('Error', 'Something went wrong.'); } finally { setSendingReply(false); } }, [currentStory, myId, replyText, sendingReply, resumeFrom]);

  const handlePollVote = useCallback(async (optionId: string) => { if (!poll || votingOptionId) return; setVotingOptionId(optionId); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); try { const updated = await storiesService.voteStoryPoll(poll.poll_id, optionId); setPoll(updated); } catch (e) { console.log('[StoryPoll.vote]', e); Alert.alert('Error', 'Could not submit vote.'); } finally { setVotingOptionId(null); } }, [poll, votingOptionId]);
  const openPollVoters = useCallback(async (optionId: string) => { if (!poll) return; if (viewersOpen) closeViewersList(); pauseFor('pollVoters'); setPollVotersOptionId(optionId); setPollVotersOpen(true); setLoadingPollVoters(true); try { const voters = await storiesService.getStoryPollVoters(poll.poll_id, optionId); setPollVoters(voters); } catch (e) { console.log('[StoryPoll.voters]', e); setPollVoters([]); } finally { setLoadingPollVoters(false); } }, [poll, viewersOpen, closeViewersList, pauseFor]);
  const closePollVoters = useCallback(() => { setPollVotersOpen(false); setPollVoters([]); setPollVotersOptionId(null); resumeFrom('pollVoters'); }, [resumeFrom]);
  useEffect(() => { return () => { if (toastTimer.current) clearTimeout(toastTimer.current); if (replyToastTimer.current) clearTimeout(replyToastTimer.current); if (caughtUpTimer.current) clearTimeout(caughtUpTimer.current); }; }, []);

  const openViewersList = async () => { if (!currentStory) return; if (pollVotersOpen) closePollVoters(); pauseFor('viewers'); setViewersOpen(true); setLoadingViewers(true); try { const isOwnStory = currentStory.user_id === myId; const [list, reactions] = await Promise.all([storiesService.getViewers(currentStory.id), isOwnStory ? storiesService.getReactions(currentStory.id) : Promise.resolve([])]); setViewers(list); const rMap = new Map<string, string[]>(); (reactions || []).forEach((r: StoryReaction) => { const existing = rMap.get(r.user_id) || []; existing.push(r.emoji); rMap.set(r.user_id, existing); }); setViewerReactions(rMap); setReactionsCount(rMap.size); } catch (e) { console.log('[getViewers]', e); } finally { setLoadingViewers(false); } };
  const closeViewersList = () => { setViewersOpen(false); setViewers([]); setViewerReactions(new Map()); setReactionsCount(0); resumeFrom('viewers'); };
  const openViewerProfile = (userId: string) => { closeViewersList(); setTimeout(() => { navigation.navigate('UserProfile', { userId }); }, 300); };

  const handleEngagementTap = useCallback((_stickerId: string) => { pauseFor('engagement'); }, [pauseFor]);
  const handleSliderSubmit = useCallback(async (stickerId: string, value: number) => { if (!currentStory) return; try { await storiesService.submitStickerResponse({ storyId: currentStory.id, stickerId, responseType: 'slider', numberValue: value }); dispatchEngagement({ type: 'SET_RESPONSE', stickerId, value: { number_value: value } }); } catch (e) { console.log('[SliderSubmit]', e); } }, [currentStory?.id]);
  const handleQuizSubmit = useCallback(async (stickerId: string, optionId: string) => { if (!currentStory) return; try { await storiesService.submitStickerResponse({ storyId: currentStory.id, stickerId, responseType: 'quiz', optionId }); dispatchEngagement({ type: 'SET_RESPONSE', stickerId, value: { option_id: optionId } }); } catch (e) { console.log('[QuizSubmit]', e); } }, [currentStory?.id]);
  const handleViewResponses = useCallback((stickerId: string, responseType: 'question' | 'slider' | 'quiz') => { const stickerList = (storiesRef.current[storyIndexRef.current]?.stickers_json || []) as StoryTextSticker[]; const sticker = stickerList.find(s => s.id === stickerId); pauseFor('responsesSheet'); dispatchResponsesSheet({ type: 'OPEN', stickerId, responseType, title: sticker?.questionPrompt || sticker?.sliderLabel || sticker?.quizQuestion || sticker?.text || '', quizOptions: sticker?.quizOptions }); }, [pauseFor]);

  const isOwn = currentStory?.user_id === myId;
  const engagementProps = useMemo(() => ({ isOwn: isOwn ?? false, storyId: currentStory?.id ?? '', myResponses: engagement.responses, responseCounts: engagement.counts, responseAverages: engagement.averages, quizResponseCounts: engagement.quizCounts, onTapQuestionAnswer: handleEngagementTap, onSubmitSlider: handleSliderSubmit, onSelectQuizOption: handleQuizSubmit, onViewResponses: handleViewResponses, onSliderDragStart: () => pauseFor('sliderDrag'), onSliderDragEnd: () => resumeFrom('sliderDrag') }), [isOwn, currentStory?.id, engagement, handleEngagementTap, handleSliderSubmit, handleQuizSubmit, handleViewResponses, pauseFor, resumeFrom]);
  const handleMediaLayout = useCallback((e: LayoutChangeEvent) => { const { width, height } = e.nativeEvent.layout; setMediaSize(prev => { if (prev.w === width && prev.h === height) return prev; return { w: width, h: height }; }); }, []);

  // Dual reconstruction
  const dualLayout = useMemo(() => parseDualLayout((currentStory as any)?.dual_layout), [currentStory]);
  const dualFrontUrl: string | undefined = (currentStory as any)?.dual_front_url ?? undefined;
  const hasDual = !!dualFrontUrl && !!dualLayout;
  console.log('[Viewer.dual]', { storyId: currentStory?.id?.slice(0, 8), hasDual, dualFrontUrl: !!dualFrontUrl, dualLayout: dualLayout ? JSON.stringify(dualLayout).slice(0, 150) : null });
  const dualMode = dualLayout?.mode ?? 'pip_front_small';

  const rearUrl = currentStory?.media_url;
  const frontUrl = dualFrontUrl;
  const effectivePrimaryUrl = useMemo(() => {
    if (!hasDual) return rearUrl;
    const authoredPrimary = dualLayout!.primaryCamera === 'front' ? frontUrl : rearUrl;
    const authoredSecondary = dualLayout!.primaryCamera === 'front' ? rearUrl : frontUrl;
    return dualSwapped ? authoredSecondary : authoredPrimary;
  }, [hasDual, dualLayout, rearUrl, frontUrl, dualSwapped]);
  const effectiveSecondaryUrl = useMemo(() => {
    if (!hasDual) return undefined;
    const authoredPrimary = dualLayout!.primaryCamera === 'front' ? frontUrl : rearUrl;
    const authoredSecondary = dualLayout!.primaryCamera === 'front' ? rearUrl : frontUrl;
    return dualSwapped ? authoredPrimary : authoredSecondary;
  }, [hasDual, dualLayout, rearUrl, frontUrl, dualSwapped]);

  const dualBubbleViewStyle = useMemo(() => {
    if (!hasDual || !dualLayout) return null;
    if (dualMode === 'split_vertical' || dualMode === 'split_horizontal') return null;
    const bScale = dualLayout.scale;
    const bw = DUAL_BUBBLE_BASE_W * bScale; const bh = DUAL_BUBBLE_BASE_H * bScale;
    const bx = (dualLayout.nx * SCREEN_W) - (bw / 2); const by = (dualLayout.ny * SCREEN_H) - (bh / 2);
    const clampedX = Math.max(4, Math.min(bx, SCREEN_W - bw - 4));
    const clampedY = Math.max(insets.top + 4, Math.min(by, SCREEN_H - bh - insets.bottom - 4));
    const isBorderless = dualMode === 'floating_bubble';
    return { left: clampedX, top: clampedY, width: bw, height: bh, borderRadius: DUAL_BUBBLE_RADIUS * bScale, borderWidth: isBorderless ? 0 : 2.5 };
  }, [hasDual, dualLayout, dualMode, insets.top, insets.bottom]);

  const isSplitMode = dualMode === 'split_vertical' || dualMode === 'split_horizontal';

  if (loading) { return (<View style={s.rootLoading}><StatusBar hidden /><ActivityIndicator color="rgba(245,240,235,0.3)" size="small" /></View>); }
  if (!currentStory) { return (<View style={s.rootLoading}><StatusBar hidden /><Text style={s.emptyTxt}>No moments here</Text><TouchableOpacity style={{ marginTop: 24 }} onPress={() => saveAndGoBack()}><Text style={{ color: 'rgba(245,240,235,0.45)', fontSize: 14, letterSpacing: 0.3 }}>Return</Text></TouchableOpacity></View>); }

  const stickers = (currentStory.stickers_json || []) as StoryTextSticker[];
  const heartActive = myReactions.has('\u2764\uFE0F');
  const canSendReply = replyText.trim().length > 0 && !sendingReply;
  const mediaMt = parseMediaTransform((currentStory as any).media_transform);
  const mediaFitMode = mediaMt?.fit || 'cover';
  const mediaHasTransform = mediaMt != null && (mediaMt.scale !== 1 || mediaMt.translateNX !== 0 || mediaMt.translateNY !== 0);
  const holdoverFitMode = holdoverMedia?.transform?.fit || 'cover';
  const holdoverHasTransform = holdoverMedia?.transform != null && (holdoverMedia.transform.scale !== 1 || holdoverMedia.transform.translateNX !== 0 || holdoverMedia.transform.translateNY !== 0);

  const renderSplitDual = () => {
    if (!hasDual || !isSplitMode) return null;
    const isVertical = dualMode === 'split_vertical';
    const primaryStyle = isVertical ? { position: 'absolute' as const, left: 0, top: 0, width: (SCREEN_W - SPLIT_GAP) / 2, height: SCREEN_H } : { position: 'absolute' as const, left: 0, top: 0, width: SCREEN_W, height: (SCREEN_H - SPLIT_GAP) / 2 };
    const secondaryStyle = isVertical ? { position: 'absolute' as const, left: (SCREEN_W + SPLIT_GAP) / 2, top: 0, width: (SCREEN_W - SPLIT_GAP) / 2, height: SCREEN_H } : { position: 'absolute' as const, left: 0, top: (SCREEN_H + SPLIT_GAP) / 2, width: SCREEN_W, height: (SCREEN_H - SPLIT_GAP) / 2 };
    return (
      <ReAnimated.View style={[StyleSheet.absoluteFill, { zIndex: 1 }, dualSwapAnimStyle]}>
        <View style={[primaryStyle, { overflow: 'hidden' }]}><Image source={effectivePrimaryUrl ? { uri: effectivePrimaryUrl } : undefined} style={{ width: SCREEN_W, height: SCREEN_H }} resizeMode="cover" fadeDuration={0} onLoadEnd={() => setMediaReady(true)} onError={() => { setMediaError(true); setMediaReady(true); }} /></View>
        <View style={[secondaryStyle, { overflow: 'hidden' }]}><TouchableOpacity activeOpacity={0.9} onPress={handleDualSwapTap} style={{ flex: 1 }}><Image source={effectiveSecondaryUrl ? { uri: effectiveSecondaryUrl } : undefined} style={{ width: SCREEN_W, height: SCREEN_H }} resizeMode="cover" fadeDuration={0} /></TouchableOpacity></View>
        {isVertical && <View style={{ position: 'absolute', left: (SCREEN_W - SPLIT_GAP) / 2, top: 0, width: SPLIT_GAP, height: SCREEN_H, backgroundColor: '#020408' }} />}
        {!isVertical && <View style={{ position: 'absolute', left: 0, top: (SCREEN_H - SPLIT_GAP) / 2, width: SCREEN_W, height: SPLIT_GAP, backgroundColor: '#020408' }} />}
      </ReAnimated.View>
    );
  };

  const renderPipDual = () => {
    if (!hasDual || isSplitMode || !dualBubbleViewStyle || !effectiveSecondaryUrl) return null;
    return (
      <ReAnimated.View style={[s.dualBubble, dualBubbleViewStyle, { zIndex: 2 }, dualSwapAnimStyle, bubbleEntryAnimStyle]} pointerEvents="box-only">
        <TouchableOpacity activeOpacity={0.9} onPress={handleDualSwapTap} style={{ flex: 1 }}>
          <Image source={{ uri: effectiveSecondaryUrl }} style={s.dualBubbleImg} resizeMode="cover" fadeDuration={0} />
        </TouchableOpacity>
      </ReAnimated.View>
    );
  };

  return (
    <Animated.View style={[s.root, { transform: [{ translateY }, { scale: translateY.interpolate({ inputRange: [-SCREEN_H * 0.3, 0, SCREEN_H], outputRange: [1, 1, 0.92], extrapolate: 'clamp' }) }] }]} {...panResponder.panHandlers}>
      <StatusBar hidden />
      <ReAnimated.View style={[{ flex: 1 }, tapScaleStyle]}>
      <Animated.View style={{ flex: 1, transform: [{ scale: contentScale }] }}>
      <View style={s.mediaWrap} pointerEvents="box-none" onLayout={handleMediaLayout}>
        <ReAnimated.View style={[StyleSheet.absoluteFill, microParallaxStyle]}>
        {holdoverMedia && holdoverMedia.type === 'image' && (<View style={[StyleSheet.absoluteFill, { zIndex: 0 }]}>{holdoverFitMode === 'contain' && (<Image source={{ uri: holdoverMedia.url }} style={[s.media, { position: 'absolute', zIndex: -1, opacity: 0.22 }]} resizeMode="cover" blurRadius={35} fadeDuration={0} />)}<Image source={{ uri: holdoverMedia.url }} style={[s.media, holdoverHasTransform ? { transform: [{ translateX: holdoverMedia.transform!.translateNX * mediaSize.w }, { translateY: holdoverMedia.transform!.translateNY * mediaSize.h }, { scale: holdoverMedia.transform!.scale }] } : undefined]} resizeMode={holdoverFitMode} fadeDuration={0} /></View>)}
        {holdoverMedia && holdoverMedia.type === 'video' && (<View style={[StyleSheet.absoluteFill, { zIndex: 0, backgroundColor: '#020408' }]} />)}

        {hasDual && isSplitMode ? renderSplitDual() : (
          <ReAnimated.View style={[StyleSheet.absoluteFill, activeMediaAnimStyle, { zIndex: 1 }]}>
            {isText ? ((() => { const bg = (currentStory as any)?.text_background; if (bg?.kind === 'gradient' && bg.colors?.length === 2) { return (<LinearGradient colors={bg.colors} start={bg.direction === 'diagonal' ? { x: 0, y: 0 } : { x: 0.5, y: 0 }} end={bg.direction === 'diagonal' ? { x: 1, y: 1 } : { x: 0.5, y: 1 }} style={s.media} />); } const solidColor = bg?.kind === 'solid' && bg.color ? bg.color : '#0B1E3D'; return <View style={[s.media, { backgroundColor: solidColor }]} />; })()
            ) : isVideo ? (<VideoView style={s.media} player={videoPlayer} contentFit="cover" nativeControls={false} onFirstFrameRender={() => setMediaReady(true)} />
            ) : (<>{mediaFitMode === 'contain' && currentStory.media_url && (<Image source={{ uri: currentStory.media_url }} style={[s.media, { position: 'absolute', zIndex: -1, opacity: 0.22 }]} resizeMode="cover" blurRadius={35} fadeDuration={0} />)}<Image source={hasDual && effectivePrimaryUrl ? { uri: effectivePrimaryUrl } : (currentStory.media_url ? { uri: currentStory.media_url } : undefined)} style={[s.media, mediaHasTransform && !hasDual ? { transform: [{ translateX: mediaMt!.translateNX * mediaSize.w }, { translateY: mediaMt!.translateNY * mediaSize.h }, { scale: mediaMt!.scale }] } : undefined]} resizeMode={mediaFitMode} fadeDuration={0} onLoadEnd={() => setMediaReady(true)} onError={() => { setMediaError(true); setMediaReady(true); }} /></>)}
          </ReAnimated.View>
        )}
        </ReAnimated.View>

        {renderPipDual()}
        {mediaError && (<View style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 4 }}><Feather name="image" size={28} color="rgba(245,240,235,0.08)" /><Text style={{ color: 'rgba(245,240,235,0.15)', fontSize: 12, marginTop: 14, letterSpacing: 0.5, fontWeight: '500' }}>Unavailable</Text></View>)}
        <StickerOverlay stickers={stickers} containerW={mediaSize.w} containerH={mediaSize.h} onMentionTap={(userId) => navigation.navigate('UserProfile', { userId })} engagementProps={engagementProps} />
      </View>
      </Animated.View>
      </ReAnimated.View>

      <EnvironmentLayer chromeOpacity={chromeOpacity} isPaused={paused} isOwn={isOwn ?? false} />
      {poll && (() => { const clampedTop = Math.max(insets.top + 90, Math.min(poll.ny * SCREEN_H - 100, SCREEN_H - 360)); const clampedLeft = (poll.nx * SCREEN_W) - (SCREEN_W * 0.4); return (<View style={[s.pollOverlay, { top: clampedTop, left: clampedLeft }]} pointerEvents="auto" onLayout={(e) => { const layout = e.nativeEvent.layout; pollLayoutRef.current = { top: clampedTop, bottom: clampedTop + layout.height, left: clampedLeft, right: clampedLeft + layout.width }; }}><PollCard poll={poll} isOwn={isOwn} onVote={handlePollVote} onOpenVoters={openPollVoters} /></View>); })()}
      <MemoryProgressArc progressSV={progressSV} currentIndex={storyIndex} totalStories={stories.length} chromeOpacity={chromeOpacity} topInset={insets.top} isPaused={paused} bottomInset={insets.bottom} />
      <MemoryCaption caption={currentStory.caption} chromeOpacity={chromeOpacity} bottomOffset={isOwn ? 130 : 125 + insets.bottom} />
      <IdentityPresence user={storyUser} isOwn={isOwn ?? false} timeAgo={timeAgo(currentStory.created_at)} scope={currentStory.scope} category={(currentStory as any).category} viewsCount={currentStory.views_count} chromeOpacity={chromeOpacity} topInset={insets.top} onOpenViewers={isOwn ? openViewersList : undefined} onSaveHighlight={isOwn ? () => { pauseFor('highlight'); setHighlightSheetOpen(true); } : undefined} onDelete={isOwn ? handleDelete : undefined} onClose={saveAndGoBack} bottomInset={insets.bottom} />
      {!isOwn && (<ImmersiveReplyField replyMode={replyMode} replyText={replyText} onChangeText={setReplyText} sendingReply={sendingReply} heartActive={heartActive} chromeOpacity={chromeOpacity} onOpenReply={openReplyInput} onCloseReply={closeReplyInput} onSendReply={sendReply} onHeartTap={handleHeartTap} onLongPressHeart={openPicker} canSend={canSendReply} keyboardHeight={keyboardHeight} bottomInset={insets.bottom} inputRef={replyInputRef} />)}

      {reactionToast && (<View pointerEvents="none" style={s.toastWrap}><View style={s.toastBubble}><Text style={s.toastEmoji}>{reactionToast}</Text><Text style={s.toastText}>Sent</Text></View></View>)}
      {replyToast && (<View pointerEvents="none" style={s.replyToastWrap}><View style={s.replyToastBubble}><Feather name="check" size={14} color="rgba(245,240,235,0.8)" /><Text style={s.replyToastText}>Delivered</Text></View></View>)}

      {pickerOpen && (<TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={closePicker}><ReAnimated.View style={[s.pickerContainer, { bottom: 100 + insets.bottom }, pickerAnimStyle]}>{REACTION_EMOJIS.map(emoji => (<TouchableOpacity key={emoji} style={[s.pickerEmoji, myReactions.has(emoji) && s.pickerEmojiActive]} activeOpacity={0.7} onPress={() => handlePickerEmoji(emoji)}><Text style={s.pickerEmojiText}>{emoji}</Text></TouchableOpacity>))}</ReAnimated.View></TouchableOpacity>)}

      <Modal visible={viewersOpen} transparent animationType="slide" onRequestClose={closeViewersList}>
        <TouchableOpacity style={s.viewersOverlay} activeOpacity={1} onPress={closeViewersList}>
          <TouchableOpacity activeOpacity={1} style={s.viewersSheet}>
            <View style={s.viewersHandle} />
            <View style={s.insightsStatsRow}>
              <View style={s.insightStat}><View style={s.insightStatIcon}><Feather name="eye" size={15} color={NAVY} /></View><View><Text style={s.insightStatVal}>{currentStory.views_count}</Text><Text style={s.insightStatLbl}>Views</Text></View></View>
              <View style={s.insightStat}><View style={s.insightStatIcon}><Feather name="heart" size={15} color={NAVY} /></View><View><Text style={s.insightStatVal}>{reactionsCount}</Text><Text style={s.insightStatLbl}>Reactions</Text></View></View>
              <View style={s.insightStat}><View style={s.insightStatIcon}><Feather name={currentStory.scope === 'institution' ? 'award' : 'globe'} size={15} color={NAVY} /></View><View><Text style={s.insightStatVal}>{currentStory.scope === 'institution' ? 'School' : 'Global'}</Text><Text style={s.insightStatLbl}>Audience</Text></View></View>
            </View>
            <View style={s.viewersTabRow}><View style={[s.viewersTab, s.viewersTabActive]}><Text style={s.viewersTabTxtActive}>Your circle · {currentStory.views_count}</Text></View></View>
            {loadingViewers ? (<View style={s.viewersLoader}><ActivityIndicator size="small" color={NAVY} /></View>) : viewers.length === 0 ? (<View style={s.viewersEmpty}><View style={s.viewersEmptyIcon}><Feather name="users" size={20} color="#C7C7CC" /></View><Text style={s.viewersEmptyTxt}>No one yet</Text><Text style={s.viewersEmptySub}>Your circle will appear here.</Text></View>) : (
              <FlatList data={viewers} keyExtractor={(v) => v.user_id} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }} renderItem={({ item }) => { const userEmojis = viewerReactions.get(item.user_id); return (
                <TouchableOpacity style={s.viewerRow} activeOpacity={0.7} onPress={() => openViewerProfile(item.user_id)}>
                  {item.avatar_url ? (<Image source={{ uri: item.avatar_url }} style={s.viewerAvatar} />) : (<View style={[s.viewerAvatar, s.viewerAvatarFb]}><Text style={s.viewerAvatarTxt}>{initials(item.full_name)}</Text></View>)}
                  <View style={{ flex: 1, minWidth: 0 }}><Text style={s.viewerName} numberOfLines={1}>{item.full_name || 'User'}</Text>{item.username ? (<Text style={s.viewerUsername} numberOfLines={1}>@{item.username}</Text>) : null}</View>
                  {userEmojis && userEmojis.length > 0 && (<Text style={s.viewerEmojis}>{userEmojis.join('')}</Text>)}<Text style={s.viewerTime}>{timeAgo(item.viewed_at)}</Text>
                </TouchableOpacity>); }} />)}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={pollVotersOpen} transparent animationType="slide" onRequestClose={closePollVoters}>
        <TouchableOpacity style={s.viewersOverlay} activeOpacity={1} onPress={closePollVoters}>
          <TouchableOpacity activeOpacity={1} style={s.pollVotersSheet}>
            <View style={s.viewersHandle} />
            <View style={s.pollVotersHeader}><Text style={s.pollVotersTitle}>{poll?.options.find(o => o.id === pollVotersOptionId)?.label || 'Voters'}</Text><TouchableOpacity onPress={closePollVoters} style={{ padding: 4 }}><Feather name="x" size={20} color="#333" /></TouchableOpacity></View>
            {loadingPollVoters ? (<View style={s.viewersLoader}><ActivityIndicator size="small" color={NAVY} /></View>) : pollVoters.length === 0 ? (<View style={s.viewersEmpty}><Text style={s.viewersEmptyTxt}>No votes yet</Text></View>) : (
              <FlatList data={pollVoters} keyExtractor={v => v.user_id} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }} renderItem={({ item }) => (
                <TouchableOpacity style={s.viewerRow} activeOpacity={0.7} onPress={() => { closePollVoters(); setTimeout(() => navigation.navigate('UserProfile', { userId: item.user_id }), 300); }}>
                  {item.avatar_url ? (<Image source={{ uri: item.avatar_url }} style={s.viewerAvatar} />) : (<View style={[s.viewerAvatar, s.viewerAvatarFb]}><Text style={s.viewerAvatarTxt}>{initials(item.full_name)}</Text></View>)}
                  <View style={{ flex: 1, minWidth: 0 }}><Text style={s.viewerName} numberOfLines={1}>{item.full_name || 'User'}</Text>{item.username ? (<Text style={s.viewerUsername} numberOfLines={1}>@{item.username}</Text>) : null}</View>
                  <Text style={s.viewerTime}>{timeAgo(item.voted_at)}</Text>
                </TouchableOpacity>)} />)}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {caughtUp && (<ReAnimated.View style={[StyleSheet.absoluteFillObject, { zIndex: 50 }, caughtUpAnimStyle]}>
        <TouchableOpacity style={s.caughtUpOverlay} activeOpacity={1} onPress={() => { if (caughtUpTimer.current) { clearTimeout(caughtUpTimer.current); caughtUpTimer.current = null; } saveAndGoBack(); }}>
          <LinearGradient colors={['transparent', 'rgba(2,4,8,0.2)', 'rgba(2,4,8,0.5)']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={s.caughtUpContent}><View style={s.caughtUpRing}><View style={s.caughtUpIcon}><Feather name="check" size={24} color="rgba(245,240,235,0.75)" /></View></View><Text style={s.caughtUpTitle}>All caught up</Text><Text style={s.caughtUpSub}>You've seen every moment</Text></View>
        </TouchableOpacity>
      </ReAnimated.View>)}

      {isOwn && myId && currentStory && (<SaveToHighlightSheet visible={highlightSheetOpen} onClose={() => { setHighlightSheetOpen(false); resumeFrom('highlight'); }} storyId={currentStory.id} userId={myId} />)}
      {responsesSheet.open && (<StickerResponsesSheet visible={responsesSheet.open} onClose={() => { dispatchResponsesSheet({ type: 'CLOSE' }); resumeFrom('responsesSheet'); }} storyId={currentStory.id} stickerId={responsesSheet.stickerId} responseType={responsesSheet.type} title={responsesSheet.title} quizOptions={responsesSheet.quizOptions} />)}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#020408' },
  rootLoading: { flex: 1, backgroundColor: '#020408', alignItems: 'center', justifyContent: 'center' },
  emptyTxt: { color: 'rgba(245,240,235,0.4)', fontSize: 15, letterSpacing: 0.3 },
  mediaWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: '#020408', overflow: 'hidden' },
  media: { width: SCREEN_W, height: SCREEN_H },
  dualBubble: { position: 'absolute', overflow: 'hidden', borderColor: 'rgba(255,255,255,0.5)', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  dualBubbleImg: { width: '100%', height: '100%' },
  pollOverlay: { position: 'absolute', width: SCREEN_W * 0.8, zIndex: 12, alignItems: 'center' },
  toastWrap: { position: 'absolute', top: '40%', left: 0, right: 0, alignItems: 'center', zIndex: 40 },
  toastBubble: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(2,4,8,0.8)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(245,240,235,0.05)' },
  toastEmoji: { fontSize: 20 },
  toastText: { color: 'rgba(245,240,235,0.65)', fontSize: 13, fontWeight: '500' },
  replyToastWrap: { position: 'absolute', bottom: 120, left: 0, right: 0, alignItems: 'center', zIndex: 40 },
  replyToastBubble: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(2,4,8,0.8)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(245,240,235,0.05)' },
  replyToastText: { color: 'rgba(245,240,235,0.65)', fontSize: 13, fontWeight: '500' },
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,4,8,0.25)', zIndex: 30 },
  pickerContainer: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(8,12,24,0.88)', borderRadius: 24, paddingHorizontal: 14, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(245,240,235,0.06)' },
  pickerEmoji: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  pickerEmojiActive: { backgroundColor: 'rgba(245,240,235,0.08)' },
  pickerEmojiText: { fontSize: 26 },
  viewersOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  viewersSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 10, maxHeight: '80%' },
  viewersHandle: { width: 32, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0', alignSelf: 'center', marginBottom: 12 },
  insightsStatsRow: { flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 16, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  insightStat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  insightStatIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' },
  insightStatVal: { fontSize: 15, fontWeight: '700', color: '#000', letterSpacing: -0.2 },
  insightStatLbl: { fontSize: 11, color: '#8E8E93', marginTop: 1 },
  viewersTabRow: { flexDirection: 'row', paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  viewersTab: { paddingVertical: 10, paddingHorizontal: 2, marginRight: 20 },
  viewersTabActive: { borderBottomWidth: 2, borderBottomColor: NAVY, marginBottom: -StyleSheet.hairlineWidth },
  viewersTabTxtActive: { fontSize: 13, fontWeight: '700', color: NAVY },
  viewersLoader: { paddingVertical: 40, alignItems: 'center' },
  viewersEmpty: { paddingVertical: 40, paddingHorizontal: 40, alignItems: 'center', gap: 6 },
  viewersEmptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#F5F5F7', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  viewersEmptyTxt: { fontSize: 15, fontWeight: '700', color: '#000' },
  viewersEmptySub: { fontSize: 13, color: '#8E8E93', textAlign: 'center', lineHeight: 18 },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  viewerAvatar: { width: 40, height: 40, borderRadius: 20 },
  viewerAvatarFb: { backgroundColor: '#F5F5F7', alignItems: 'center', justifyContent: 'center' },
  viewerAvatarTxt: { fontSize: 14, fontWeight: '700', color: NAVY },
  viewerName: { fontSize: 15, fontWeight: '600', color: '#000000', letterSpacing: -0.2 },
  viewerUsername: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  viewerEmojis: { fontSize: 16, marginRight: 2 },
  viewerTime: { fontSize: 12, color: 'rgba(142,142,147,0.7)', fontWeight: '500' },
  pollVotersSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 10, maxHeight: '60%' },
  pollVotersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  pollVotersTitle: { fontSize: 16, fontWeight: '700', color: '#000' },
  caughtUpOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(2,4,8,0.9)' },
  caughtUpContent: { alignItems: 'center' },
  caughtUpRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: 'rgba(196,184,168,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  caughtUpIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(196,184,168,0.06)', alignItems: 'center', justifyContent: 'center' },
  caughtUpTitle: { color: 'rgba(245,240,235,0.88)', fontSize: 21, fontWeight: '600', letterSpacing: -0.3 },
  caughtUpSub: { color: 'rgba(245,240,235,0.35)', fontSize: 14, marginTop: 6, letterSpacing: 0.2 },
});