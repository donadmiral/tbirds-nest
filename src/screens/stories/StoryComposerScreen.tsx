import { normalizeStoryCapture, STORY_CLIP_LIMIT } from '../../../shared/storyCapture';
import { storyLayerWindow } from '../../../shared/storyPresentation';
import StoryTimingPanel from '../../components/stories/StoryTimingPanel';
import StoryTextEditorToolbar from '../../components/stories/StoryTextEditorToolbar';
import { storyHandles } from '../../../shared/storyMentions';
import SaveToMemorySheet from '../../components/stories/SaveToMemorySheet';
import StoryAudienceSheet from '../../components/stories/StoryAudienceSheet';
import { updateDraftStickers, type StickerChange } from '../../controllers/stories/stickerDraftUpdates';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, TextInput, FlatList,
  ActivityIndicator, Alert, Platform, StatusBar, KeyboardAvoidingView,
  Dimensions, Modal, ScrollView, Animated, Keyboard, AccessibilityInfo, Easing, Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import ReAnimated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useStoryAudioMix } from '../../hooks/useStoryAudioMix';
import { useStorySoundPreview } from '../../hooks/useStorySoundPreview';
import VideoThumb from '../../components/VideoThumb';
import StudioRail, { type RailItem } from '../../components/stories/StudioRail';
import TrimStrip from '../../components/stories/TrimStrip';
import StudioSheet, { type StudioTile } from '../../components/stories/StudioSheet';
import { LinearGradient } from 'expo-linear-gradient';
import {
  storiesService, StoryTextSticker, StoryStickerStyle, MediaFit, MediaTransform,
  StoryCategory, StoryTextBackground,
} from '../../services/storiesService';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import { stickerTextStyle, STICKER_STYLES, STICKER_STYLE_LABELS, BASE_FONT_SIZES } from '../../utils/stickerStyles';
import StickerOverlay from '../../components/stories/StickerOverlay';
import StickerPill from '../../components/stories/StickerPill';
import PollCard from '../../components/stories/PollCard';
import VerifiedBadge from '../../components/VerifiedBadge';
import TierName from '../../components/TierName';
import DraggableSticker from '../../components/stories/DraggableSticker';
import type { SmartGuideEntry } from '../../components/stories/DraggableSticker';
import MediaCanvas from '../../components/stories/MediaCanvas';
import CategoryPicker from '../../components/stories/CategoryPicker';
import MusicSheet from '../../components/stories/MusicSheet';
import { FilterLayer, FilterPickerSheet } from '../../components/stories/StoryFilters';
import type { StoryAudioDraft } from '../../services/storiesService';
import StickerIcon from '../../components/stories/StickerIcons';
import VideoTrimmer, { autoSegments, STORY_MAX_SEC } from '../../components/stories/VideoTrimmer';
import DrawSurface, { DrawingLayer, type DrawStroke } from '../../components/stories/DrawLayer';
import { MiniSlider, AdjustPanel, AdjustLayer, BackgroundSheet, BackgroundLayer, AudioMixSheet, EntitySheet, PreviewChrome, type StoryAdjust, type StoryBg, type StoryMix, type EntityPick } from '../../components/stories/storyPanels';
import { EXTRA_TEXT_STYLES, EXTRA_TEXT_LABELS, composedTextStyle, TEXT_ANIMS, fetchWeatherNow, PHOTO_SHAPES, TIME_STYLES, DATE_STYLES, WEATHER_STYLES } from '../../components/stories/storyExtras';
import GifPickerLite from '../../components/GifPickerLite';
import PollDragWrap from '../../components/stories/PollDragWrap';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import {
  getBloomTools, BLOOM_RADIUS, INVOKE_SIZE, BLOOM_TOOL_SIZE,
  type BloomToolDef,
} from '../../components/stories/composerTheme';
import DualArrangementOverlay, { type CompositionPreset } from '../../components/stories/DualArrangementOverlay';
import { PanGestureHandler, TapGestureHandler } from 'react-native-gesture-handler';
import {
  BUBBLE_BASE_WIDTH, BUBBLE_BASE_HEIGHT,
  Z_BUBBLE, Z_STICKERS, Z_CHROME, Z_BLOOM, Z_SCRIM,
  SHADOW_BUBBLE, SHADOW_CANVAS,
} from '../../constants/motionDualMemory';
import {
  palette, surface, text as textColor, accent, border as borderColor,
  space, typeSize, fontWeight,
} from '../../constants/tokens';

// ── Extracted controllers ──
import { useBubbleController } from '../../controllers/stories/useBubbleController';
import { useArrangementController } from '../../controllers/stories/useArrangementController';
import { useBloomOrchestrator } from '../../controllers/stories/useBloomOrchestrator';
import { useKeyboardOrchestrator } from '../../controllers/stories/useKeyboardOrchestrator';
import { usePublishOrchestrator } from '../../controllers/stories/usePublishOrchestrator';

// ── Constants ──
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const MAX_STICKERS = 10;
const STICKER_TEXT_MAX_W = Math.round(SCREEN_W * 0.85);
const DELETE_ZONE_HEIGHT = 80;
const SAFE_TOP_PX = 70;
const SAFE_BOTTOM_PX = 20;

const STICKER_COLORS = ['#FFFFFF','#0A0A0A','#E8D3B6','#F2AF99','#C5CEB4','#A7C3D0','#0B1E3D','#8B7BB8'];
const EMOJI_LIST = [
  '😀','😍','😂','😭','😎','🥳','😮','😡','🤯','🥹',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯',
  '🔥','✨','⭐','🌟','💫','🎉','👏','🙌','💪','🙏',
  '👀','💀','🤝','🫶','🐐','👑','🍕','☕','🌍','📍',
];

type TextBgOption = { id: string; label: string; bg: StoryTextBackground; previewColors: string[]; isDark: boolean };
const TEXT_BG_OPTIONS: TextBgOption[] = [
  { id: 'navy', label: 'Navy', bg: { kind: 'solid', color: '#0B1E3D' }, previewColors: ['#0B1E3D'], isDark: true },
  { id: 'warmblack', label: 'Night', bg: { kind: 'solid', color: 'rgb(6,12,24)' }, previewColors: ['rgb(6,12,24)'], isDark: true },
  { id: 'granite', label: 'Granite', bg: { kind: 'solid', color: '#45494F' }, previewColors: ['#45494F'], isDark: true },
  { id: 'white', label: 'White', bg: { kind: 'solid', color: '#FFFFFF' }, previewColors: ['#FFFFFF'], isDark: false },
  { id: 'platinum', label: 'Platinum', bg: { kind: 'gradient', colors: ['#C9BFB0', '#A89F91'], direction: 'diagonal' }, previewColors: ['#C9BFB0', '#A89F91'], isDark: false },
  { id: 'jacaranda', label: 'Jacaranda', bg: { kind: 'gradient', colors: ['#3E3468', '#8B7BB8'], direction: 'diagonal' }, previewColors: ['#3E3468', '#8B7BB8'], isDark: true },
  { id: 'flamelily', label: 'Flame Lily', bg: { kind: 'gradient', colors: ['#B3271A', '#E8A13A'], direction: 'diagonal' }, previewColors: ['#B3271A', '#E8A13A'], isDark: true },
  { id: 'kariba', label: 'Kariba', bg: { kind: 'gradient', colors: ['#E0A83C', '#1C2E4A'], direction: 'vertical' }, previewColors: ['#E0A83C', '#1C2E4A'], isDark: true },
];

function getDefaultStickerColor(bgId: string): string {
  const opt = TEXT_BG_OPTIONS.find(o => o.id === bgId);
  return opt?.isDark ? '#FFFFFF' : '#000000';
}

type PollData = { question: string; options: string[]; nx?: number; ny?: number; scale?: number };
type Draft = {
  id: string; localUri: string | null; thumbnailUri: string | null;
  mediaType: 'image' | 'video' | 'text'; caption: string; scope: 'global'; audience?: 'everyone' | 'followers' | 'close_friends' | 'only_with' | 'except'; sharedWith?: string[] | null; reach?: 'followers' | 'wider';
  uploadState: 'idle' | 'uploading' | 'done' | 'error'; errorMsg?: string | null;
  durationSec?: number | null; pollData?: PollData | null; stickers?: StoryTextSticker[];
  imageW?: number; imageH?: number; mediaFit: MediaFit; mediaTransform: MediaTransform;
  category: StoryCategory | null; textBgId: string; textBackground: StoryTextBackground | null;
  dualFrontUri?: string | null; dualLayout?: any | null;
  audio?: StoryAudioDraft | null; filterId?: string | null;
  hiddenMentions?: { id: string; username: string }[] | null; allowMentionReshare?: boolean; allowReplies?: boolean;
};

/** Review uses the same media, filters, drawing and sticker renderers as the canvas. */
function StoryReviewPreview({ draft, width, height, textBackground, strokes }: { draft: Draft; width: number; height: number; textBackground: React.ReactNode; strokes: DrawStroke[] }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const frameW = Math.max(1, width), frameH = Math.max(1, height), ratio = 132 / frameW;
  const tx = draft.mediaTransform as any;
  const overlays = <>
    <FilterLayer filterId={draft.filterId || null} amt={tx?.filterAmt} />
    <AdjustLayer adjust={tx?.adjust || null} />
    <DrawingLayer strokes={strokes.length ? strokes : null} width={frameW} height={frameH} />
    <StickerOverlay stickers={draft.stickers || []} containerW={frameW} containerH={frameH} interactive={false} storyPaused />
    {draft.pollData ? <PollDragWrap containerW={frameW} containerH={frameH} nx={draft.pollData.nx ?? .5} ny={draft.pollData.ny ?? .4} scale={draft.pollData.scale ?? 1} onChange={() => {}} onTap={() => {}}><PollCard poll={{ poll_id: 'preview', question: draft.pollData.question, options: draft.pollData.options.map((label, i) => ({ id: String(i), label, vote_count: 0 })), total_votes: 0, my_vote: null }} isOwn={false} onVote={() => {}} onOpenVoters={() => {}} /></PollDragWrap> : null}
  </>;
  return <View style={[st.sharePreview, { height: frameH * ratio }]} pointerEvents="none"><View style={{ position: 'absolute', width: frameW, height: frameH, left: (132 - frameW) / 2, top: (frameH * ratio - frameH) / 2, transform: [{ scale: ratio }] }}>
    {draft.mediaType === 'text' ? <View style={{ flex: 1 }}>{textBackground}{overlays}</View> : <MediaCanvas localUri={draft.localUri} mediaType={draft.mediaType} uploadState="idle" onRetry={() => {}} onLayout={() => {}} scaleAnim={scale} opacityAnim={opacity} imageW={draft.imageW} imageH={draft.imageH} mediaFit={draft.mediaFit} mediaTransform={draft.mediaTransform} onTransformChange={() => {}} onFitToggle={() => {}} interactive={false} bg={tx?.bg || null} videoMuted videoPaused trimStart={tx?.trimStart} trimEnd={tx?.trimEnd}>{overlays}</MediaCanvas>}
  </View></View>;
}

function newDraftId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function newStickerId() { return `stk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

type SmartGuidesState = { x: SmartGuideEntry; y: SmartGuideEntry; stickerId: string | null };

// ── ComposerStickerOverlay (unchanged from original) ──
function ComposerStickerOverlay({
  stickers, containerW, containerH, onDragEnd, onTapSticker, onScaleEnd, onRotateEnd, onDeleteDrop, player, timingPreview = false,
}: {
  stickers: StoryTextSticker[]; containerW: number; containerH: number;
  onDragEnd: (id: string, nx: number, ny: number) => void; onTapSticker: (id: string) => void;
  onScaleEnd: (id: string, s: number) => void; onRotateEnd: (id: string, r: number) => void;
  onDeleteDrop: (id: string) => void;
  player?: any; timingPreview?: boolean;
}) {
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!timingPreview || !player) return;
    setClock(Number(player.currentTime) || 0);
    const subscription = player.addListener?.('timeUpdate', (event: any) => setClock(Number(event?.currentTime ?? player.currentTime) || 0));
    // Expo does not emit timeUpdate on every paused seek. Keep timing handles
    // and visible layers aligned while scrubbing without rerendering the editor.
    const seekClock = setInterval(() => { try { setClock(Number(player.currentTime) || 0); } catch {} }, 100);
    return () => { clearInterval(seekClock); try { subscription?.remove?.(); } catch {} };
  }, [player, timingPreview]);
  // Drag feedback state lives here, not in the composer: a snap or delete-zone
  // transition re-renders this thin overlay only, never the whole editor.
  // Center guide lines are UI-thread only: the dragged sticker's worklet writes
  // these opacities directly, so no state update and no mount/unmount mid-drag.
  const guideXOp = useSharedValue(0);
  const guideYOp = useSharedValue(0);
  const guideXStyle = useAnimatedStyle(() => { 'worklet'; return { opacity: guideXOp.value }; });
  const guideYStyle = useAnimatedStyle(() => { 'worklet'; return { opacity: guideYOp.value }; });
  const [dragZone, setDragZone] = useState<{ draggingId: string | null; inDeleteZone: boolean }>({ draggingId: null, inDeleteZone: false });
  const deleteHotSV = useSharedValue(0);
  const alignXPos = useSharedValue(0); const alignYPos = useSharedValue(0); const alignXOp = useSharedValue(0); const alignYOp = useSharedValue(0);
  const alignXStyle = useAnimatedStyle(() => { 'worklet'; return { opacity: alignXOp.value, transform: [{ translateX: alignXPos.value }] }; });
  const alignYStyle = useAnimatedStyle(() => { 'worklet'; return { opacity: alignYOp.value, transform: [{ translateY: alignYPos.value }] }; });
  const deleteHotStyle = useAnimatedStyle(() => { 'worklet'; return { backgroundColor: deleteHotSV.value ? 'rgba(255,59,48,0.28)' : 'rgba(0,0,0,0.35)', transform: [{ scale: deleteHotSV.value ? 1.08 : 1 }] }; });
  const [smartGuides, setSmartGuides] = useState<SmartGuidesState>({ x: null, y: null, stickerId: null });
  const onSmartGuideChange = useCallback((id: string, x: SmartGuideEntry, y: SmartGuideEntry) => { setSmartGuides(p => (x === null && y === null) ? (p.stickerId === id ? { x: null, y: null, stickerId: null } : p) : { x, y, stickerId: id }); }, []);
  const onDragStart = useCallback((id: string) => { setDragZone({ draggingId: id, inDeleteZone: false }); }, []);
  const onDeleteZoneChange = useCallback((id: string, inZone: boolean) => { setDragZone(p => p.draggingId !== id ? p : (p.inDeleteZone === inZone ? p : { ...p, inDeleteZone: inZone })); }, []);
  const clearDrag = useCallback(() => { setDragZone({ draggingId: null, inDeleteZone: false }); deleteHotSV.value = 0; alignXOp.value = 0; alignYOp.value = 0; guideXOp.value = 0; guideYOp.value = 0; setSmartGuides({ x: null, y: null, stickerId: null }); }, []);
  const handleDragEnd = useCallback((id: string, nx: number, ny: number) => { clearDrag(); onDragEnd(id, nx, ny); }, [clearDrag, onDragEnd]);
  const handleDeleteDrop = useCallback((id: string) => { clearDrag(); onDeleteDrop(id); }, [clearDrag, onDeleteDrop]);
  // Stable per-sticker neighbour lists so React.memo on DraggableSticker holds during drags.
  const visibleStickers = useMemo(() => (stickers || []).filter(st => (st as any).kind !== 'drawing' && (!timingPreview || ((typeof st.startSec !== 'number' || clock >= st.startSec) && (typeof st.endSec !== 'number' || clock < st.endSec)))), [stickers, timingPreview, clock]);
  const othersById = useMemo(() => { const m: Record<string, StoryTextSticker[]> = {}; for (const st of visibleStickers) m[st.id] = visibleStickers.filter(s => s.id !== st.id); return m; }, [visibleStickers]);
  const deleteZoneNy = containerH > 0 ? 1 - DELETE_ZONE_HEIGHT / containerH : 0.88;
  const safeTopNy = containerH > 0 ? SAFE_TOP_PX / containerH : 0.1;
  const safeBottomNy = containerH > 0 ? 1 - SAFE_BOTTOM_PX / containerH : 0.97;
  const deleteZoneOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(deleteZoneOpacity, { toValue: dragZone.draggingId ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [dragZone.draggingId]);
  if (!stickers || stickers.length === 0 || containerW === 0 || containerH === 0) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={timingPreview ? 'none' : 'box-none'}>
      <ReAnimated.View style={[snapStyles.guideVertical, guideXStyle]} pointerEvents="none" />
      <ReAnimated.View style={[snapStyles.guideHorizontal, guideYStyle]} pointerEvents="none" />
      <ReAnimated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(201,191,176,0.9)', zIndex: 5 }, alignXStyle]} pointerEvents="none" />
      <ReAnimated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(201,191,176,0.9)', zIndex: 5 }, alignYStyle]} pointerEvents="none" />
      {smartGuides.x !== null && <View style={[snapStyles.smartGuideVertical, { left: smartGuides.x.position * containerW }]} pointerEvents="none" />}
      {smartGuides.y !== null && <View style={[snapStyles.smartGuideHorizontal, { top: smartGuides.y.position * containerH }]} pointerEvents="none" />}
      <Animated.View style={[snapStyles.deleteZone, { opacity: deleteZoneOpacity }]} pointerEvents="none">
        <ReAnimated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 }, deleteHotStyle]}>
        <Feather name="trash-2" size={20} color={'#FFFFFF'} />
        <Text style={snapStyles.deleteZoneText}>
          {'Drag here to delete'}
        </Text>
        </ReAnimated.View>
      </Animated.View>
      {visibleStickers.map(st => (
        <DraggableSticker key={st.id} sticker={st} containerW={containerW} containerH={containerH}
          onDragEnd={handleDragEnd} onTap={onTapSticker} onScaleEnd={onScaleEnd} onRotateEnd={onRotateEnd}
          guideXOp={guideXOp} guideYOp={guideYOp} onDragStart={onDragStart} onDeleteZoneChange={onDeleteZoneChange} deleteHotSV={deleteHotSV} alignXPos={alignXPos} alignYPos={alignYPos} alignXOp={alignXOp} alignYOp={alignYOp}
          onDeleteDrop={handleDeleteDrop} deleteZoneNy={deleteZoneNy} safeTopNy={safeTopNy}
          safeBottomNy={safeBottomNy} otherStickers={othersById[st.id] || []}
          onSmartGuideChange={onSmartGuideChange} />
      ))}
    </View>
  );
}

const snapStyles = StyleSheet.create({
  guideVertical: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(220,220,230,0.35)', zIndex: 5 },
  guideHorizontal: { position: 'absolute', top: '50%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(220,220,230,0.35)', zIndex: 5 },
  smartGuideVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(59,130,246,0.4)', zIndex: 5 },
  smartGuideHorizontal: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(59,130,246,0.4)', zIndex: 5 },
  deleteZone: { position: 'absolute', bottom: 0, left: 0, right: 0, height: DELETE_ZONE_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.4)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)', zIndex: 4 },
  deleteZoneActive: { backgroundColor: 'rgba(255,59,48,0.2)', borderTopColor: 'rgba(255,59,48,0.4)' },
  deleteZoneText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' as any },
  deleteZoneTextActive: { color: '#FF3B30' },
});

// ════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════

export default function StoryComposerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  const initialAssets: any[] = route.params?.assets ?? [];
  const mode: string = route.params?.mode ?? 'image';
  const seedStickers: any[] = route.params?.seedStickers ?? [];
  const seedCaption: string = route.params?.seedCaption ?? '';
  const seedText: string = route.params?.seedText ?? '';
  const isDual = mode === 'dual';
  const openArrangementOnMount = route.params?.openArrangement === true && isDual && initialAssets[0]?.rearType !== 'video';

  // ── Core draft state (stays in composer, shared across controllers) ──
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = drafts[activeIndex];
  const mountedRef = useRef(true);

  const updateActive = useCallback((patch: Partial<Draft> | ((current: Draft) => Partial<Draft>)) => {
    const draftId = active?.id;
    if (!draftId) return;
    setDrafts(prev => prev.map(d => d.id === draftId && d.uploadState !== 'uploading' && d.uploadState !== 'done'
      ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d));
  }, [active?.id]);

  // ── Accessibility ──
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  // ── Entry animation values (owned by composer, passed to publish for exit) ──
  const mediaScale = useRef(new Animated.Value(1.015)).current;
  const mediaOpacity = useRef(new Animated.Value(0.7)).current;
  const canvasScaleRef = useRef(new Animated.Value(1)).current;
  const canvasOpacityRef = useRef(new Animated.Value(1)).current;
  const entryRan = useRef(false);

  // ── Bloom tools ──
  // only_with was missing from this union, which is the only reason the
  // sheet's people picker never worked: it hands back the ids, the service
  // writes story_shared_with, and this line refused to hold the value.
  const [audience, setAudienceState] = useState<'everyone' | 'followers' | 'close_friends' | 'only_with' | 'except'>('everyone');
  const [audienceSheetOpen, setAudienceSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [allowReplies, setAllowReplies] = useState(true);
  const [addingClips, setAddingClips] = useState(false);
  const addingClipsRef = useRef(false);
  const latestDrafts = useRef(drafts); latestDrafts.current = drafts;
  const ownerRef = useRef(myId); ownerRef.current = myId;
  const [timingOpen, setTimingOpen] = useState(false);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [textPanel, setTextPanel] = useState<'font' | 'color' | 'style' | 'animate'>('font');
  const isBusiness = (profile as any)?.account_type === 'business';
  const [reach, setReachState] = useState<'followers' | 'wider'>('followers');
  const toggleReach = useCallback(() => { setReachState(prev => { const next = prev === 'followers' ? 'wider' : 'followers'; setDrafts(ds => ds.map(d => ({ ...d, reach: next } as any))); return next; }); }, []);
  // cycleAudience removed: it only flipped everyone <-> close_friends and
  // could never reach only_with. The pill opens StoryAudienceSheet instead.
  const isDualVideo = isDual && initialAssets[0]?.rearType === 'video';
  const bloomTools = useMemo(() => getBloomTools(isDual ? 'dual' : (mode as any)).filter((tl: any) => !(isDualVideo && tl.id === 'layout')), [isDual, mode, isDualVideo]);

  // ── CONTROLLER: Bloom (no deps on other controllers) ──
  const handleBloomToolAction = useCallback((toolId: string) => {
    if (toolId === 'text') openTextEditor();
    else if (toolId === 'sticker') openEmojiTray();
    else if (toolId === 'more') setOverflowOpen(true);
    else if (toolId === 'layout') { if (!isDualVideo) arrangement.openArrangement(); }
  }, []);

  // ── Publishing state ref (bridges declaration-order gap) ──
  const publishingRef = useRef(false);

  const bloom = useBloomOrchestrator({
    publishing: publishingRef.current,
    reduceMotion,
    toolCount: bloomTools.length,
    onToolTap: handleBloomToolAction,
  });

  // ── CONTROLLER: Keyboard (depends on bloom.closeBloom) ──
  const keyboard = useKeyboardOrchestrator({ closeBloom: bloom.closeBloom });

  // ── CONTROLLER: Bubble (depends on swap callback, ref-forwarded) ──
  const swapRef = useRef<() => void>(() => {});
  const arrangementOpenRef = useRef(false);
  const bubble = useBubbleController({
    initialX: 0.85 * SCREEN_W,
    initialY: 0.72 * SCREEN_H,
    initialScale: 0.8,
    screenW: SCREEN_W,
    screenH: SCREEN_H,
    insets,
    onSwap: useCallback(() => { swapRef.current(); }, []),
    arrangementOpen: arrangementOpenRef.current,
    publishing: publishingRef.current,
  });

  // ── CONTROLLER: Arrangement (depends on bubble callbacks + updateActive) ──
  const arrangement = useArrangementController({
    isDual,
    openOnMount: openArrangementOnMount,
    screenW: SCREEN_W,
    screenH: SCREEN_H,
    updateDraft: updateActive,
    animateToPreset: bubble.animateToPreset,
    getBubbleTransform: bubble.getBubbleTransform,
  });

  // Wire swap: bubble tap -> arrangement.handleSwap
  useEffect(() => { swapRef.current = arrangement.handleSwap; }, [arrangement.handleSwap]);

  // Sync refs so bloom/bubble read current values via their internal ref tracking
  useEffect(() => { arrangementOpenRef.current = arrangement.arrangementOpen; }, [arrangement.arrangementOpen]);

  const [publishedStoryIds, setPublishedStoryIds] = useState<string[]>([]);
  const onPublished = useCallback((ids: string[]) => setPublishedStoryIds(ids), []);
  const finishPublishing = useCallback(() => {
    setPublishedStoryIds([]);
    const nav: any = navigation;
    if (typeof nav.popToTop === 'function') nav.popToTop();
    else if (nav.canGoBack?.()) nav.goBack();
  }, [navigation]);

  // ── CONTROLLER: Publish (depends on bloom.closeBloom, mediaOpacity/Scale) ──
  const publish = usePublishOrchestrator({
    drafts, setDrafts, myId, navigation,
    closeBloom: bloom.closeBloom,
    mediaOpacity, mediaScale, onPublished,
  });

  // Sync publishing ref so bloom/bubble read current value
  useEffect(() => { publishingRef.current = publish.publishing; }, [publish.publishing]);

  // ── CONTROLLER: Enhancement (depends on active draft, updateActive, pushHistory, bloom.closeBloom) ──

  // ── Cleanup ──
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  // ── Entry animation ──
  useEffect(() => {
    if (drafts.length > 0 && !entryRan.current) {
      entryRan.current = true;
      if (reduceMotion) { mediaScale.setValue(1); mediaOpacity.setValue(1); return; }
      Animated.parallel([
        Animated.timing(mediaScale, { toValue: 1, duration: 600, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }),
        Animated.timing(mediaOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [drafts.length, reduceMotion]);

  // ── Draft initialization (unchanged logic) ──
  useEffect(() => {
    if (drafts.length > 0) return;
    if (mode === 'text') {
      setDrafts([{
        id: newDraftId(), localUri: null, thumbnailUri: null, mediaType: 'text', caption: '',
        scope: 'global', audience, reach, uploadState: 'idle', durationSec: null, pollData: null, stickers: seedStickers,
        imageW: 0, imageH: 0, mediaFit: 'cover' as MediaFit,
        mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover' as MediaFit },
        category: null, textBgId: 'navy', textBackground: TEXT_BG_OPTIONS[0].bg,
      }]);
      if (seedStickers.length > 0) return;
      const t = setTimeout(() => openTextEditor(), 400);
      return () => clearTimeout(t);
    }
    if (mode === 'dual' && initialAssets.length > 0) {
      const da = initialAssets[0];
      const rearUri = da.rearUri || da.localUri || da.uri;
      const frontUri = da.frontUri || null;
      const layout = da.layout || null;
      if (layout?.bubblePosition) {
        bubble.hydrateFromLayout(layout.bubblePosition.nx || 0.85, layout.bubblePosition.ny || 0.72);
      }
      if (frontUri) Image.prefetch(frontUri).catch(() => {});
      setDrafts([{
        id: newDraftId(), localUri: rearUri, thumbnailUri: null, mediaType: da.rearType === 'video' ? 'video' : 'image', caption: '',
        scope: 'global', audience, reach, uploadState: 'idle', durationSec: da.rearType === 'video' ? (da.durationSec || 15) : null, pollData: null, stickers: seedStickers,
        imageW: da.rearDimensions?.width || 0, imageH: da.rearDimensions?.height || 0,
        mediaFit: 'cover' as MediaFit,
        mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover' as MediaFit },
        category: null, textBgId: 'navy', textBackground: null,
        dualFrontUri: frontUri, dualLayout: layout,
      }]);
      if (rearUri && da.rearType !== 'video') Image.getSize(rearUri, (w, h) => { setDrafts(prev => prev.map((dd, di) => di === 0 ? { ...dd, imageW: w, imageH: h } : dd)); }, () => {});
      return;
    }
    if (initialAssets.length > 0) {
      const newDrafts: Draft[] = initialAssets.map((asset, idx) => {
        const normalized = normalizeStoryCapture(asset, mode);
        const uri = normalized.localUri;
        const isVideo = normalized.mediaType === 'video';
        if (!isVideo && uri) {
          Image.getSize(uri, (w, h) => { setDrafts(prev => prev.map((dd, di) => di === idx ? { ...dd, imageW: w, imageH: h } : dd)); }, () => {});
        }
        return {
          id: newDraftId(), localUri: uri, thumbnailUri: null, mediaType: isVideo ? 'video' as const : 'image' as const,
          caption: '', scope: 'global' as const, audience, reach, uploadState: 'idle' as const,
          durationSec: normalized.durationSec,
          pollData: null, stickers: idx === 0 ? seedStickers : [], imageW: asset.width || 0, imageH: asset.height || 0,
          mediaFit: 'cover' as MediaFit,
          mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover' as MediaFit },
          category: null, textBgId: 'navy', textBackground: null,
          filterId: (asset as any).filterId || null,
        };
      });
      setDrafts(newDrafts);
    }
  }, []);

  // ══════════════════════════════════════════════════════════
  // STICKER + MODAL STATE (next extraction target, stays for now)
  // ══════════════════════════════════════════════════════════

  const [previewSize, setPreviewSize] = useState({ w: SCREEN_W, h: SCREEN_H });
  const undoStackRef = useRef<StoryTextSticker[][]>([]);
  const redoStackRef = useRef<StoryTextSticker[][]>([]);
  const MAX_HISTORY = 30;
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  // Text editor
  const [textEditorOpen, setTextEditorOpen] = useState(false);
  const [editingStickerId, setEditingStickerId] = useState<string | null>(null);
  const [stickerAnim, setStickerAnim] = useState<string>('none');
  const [stickerStartSec, setStickerStartSec] = useState<number | null>(null);
  const [stickerEndSec, setStickerEndSec] = useState<number | null>(null);
  const [stickerText, setStickerText] = useState('');
  const [stickerStyle, setStickerStyle] = useState<StoryStickerStyle>('classic');
  const [stickerColor, setStickerColor] = useState('#FFFFFF');
  const [stickerBgEnabled, setStickerBgEnabled] = useState(false);
  const [stickerFontSize, setStickerFontSize] = useState(0);
  const [stickerOpacity, setStickerOpacity] = useState(1.0);
  const [stickerTextAlign, setStickerTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const stickerInputRef = useRef<TextInput>(null);
  const stylePickerRef = useRef<ScrollView>(null);

  // Emoji
  const [emojiTrayOpen, setEmojiTrayOpen] = useState(false);
  const [editingEmojiStickerId, setEditingEmojiStickerId] = useState<string | null>(null);

  // Link
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const linkUrlRef = useRef<TextInput>(null);

  // Location
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');
  const [locationResults, setLocationResults] = useState<any[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const locationDebounceRef = useRef<any>(null);

  // Mention
  const [mentionModalOpen, setMentionModalOpen] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionResults, setMentionResults] = useState<any[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const mentionDebounceRef = useRef<any>(null);
  const mentionSearchVersion = useRef(0);
  const [mentionHidden, setMentionHidden] = useState(false);
  const [mentionPicks, setMentionPicks] = useState<any[]>([]);

  // Question
  const [hashtagModalOpen, setHashtagModalOpen] = useState(false);
  const [hashtagText, setHashtagText] = useState('');
  const [questionModalOpen, setQuestionModalOpen] = useState(false);
  const [questionPrompt, setQuestionPrompt] = useState('');
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  // Slider
  const [sliderModalOpen, setSliderModalOpen] = useState(false);
  const [sliderLabel, setSliderLabel] = useState('');
  const [sliderEmoji, setSliderEmoji] = useState('❤️');
  const [editingSliderId, setEditingSliderId] = useState<string | null>(null);

  // Quiz
  const [quizModalOpen, setQuizModalOpen] = useState(false);
  const [quizQuestion, setQuizQuestion] = useState('');
  const [quizOptions, setQuizOptions] = useState<{ id: string; label: string; isCorrect: boolean }[]>([]);
  const [editingQuizId, setEditingQuizId] = useState<string | null>(null);

  // Poll
  const [pollEditorOpen, setPollEditorOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);

  // Overflow
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [traySearch, setTraySearch] = useState('');
  const [trayCat, setTrayCat] = useState<'interactive' | 'sharing' | 'media' | 'fun'>('interactive');
  const [countdownModalOpen, setCountdownModalOpen] = useState(false);
  const [cdTitle, setCdTitle] = useState('');
  const [cdTarget, setCdTarget] = useState<Date>(new Date(Date.now() + 24 * 3600 * 1000));
  const [musicOpen, setMusicOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const openMusicSheet = useCallback(() => setMusicOpen(true), []);
  const openFilterSheet = useCallback(() => setFilterOpen(true), []);

  // ── Creative engine state ──
  const [trimOpen, setTrimOpen] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [cutBusy, setCutBusy] = useState(false);
  const [mixOpen, setMixOpen] = useState(false);
  const [entityOpen, setEntityOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [previewOn, setPreviewOn] = useState(false);
  const [vidPlayer, setVidPlayer] = useState<any>(null);
  // Music preview in the editor at the mixed volume, exactly as the viewer will play it.
  const soundPreview = useStorySoundPreview(active?.audio, myId);
  const previewAudioUrl = soundPreview.url;
  const previewMusicVol = Math.max(0, Math.min(1, (((active?.mediaTransform as any)?.mix?.music) ?? 100) / 100));
  const previewAudio = useStoryAudioMix(previewAudioUrl, !!previewAudioUrl && !publish.publishing && !textEditorOpen && !drawMode && !musicOpen && !shareOpen, previewMusicVol, active?.audio?.durationSec);
  useEffect(() => { if (musicOpen) { try { vidPlayer?.pause?.(); } catch {} } }, [musicOpen, vidPlayer]);
  // Video drafts picked without dimensions: probe the first frame so canvas
  // gestures work and the story publishes with a real thumbnail.
  useEffect(() => {
    const d = active;
    if (!d || d.mediaType !== 'video' || !d.localUri) return;
    if ((d.imageW || 0) > 0 && d.thumbnailUri) return;
    let dead = false;
    VideoThumbnails.getThumbnailAsync(d.localUri, { time: 0, quality: 0.6 }).then(t => {
      if (dead) return;
      setDrafts(prev => prev.map(x => x.id === d.id && x.uploadState !== 'uploading' && x.uploadState !== 'done' ? { ...x, imageW: x.imageW || t.width || 0, imageH: x.imageH || t.height || 0, thumbnailUri: x.thumbnailUri || t.uri } : x));
    }).catch(() => {});
    return () => { dead = true; };
  }, [active?.id, active?.localUri, active?.mediaType, active?.imageW, active?.thumbnailUri, setDrafts]);
  const autoTrimSetRef = useRef<Set<string>>(new Set());
  const getTx = useCallback((): MediaTransform => (active?.mediaTransform || { scale: 1, translateNX: 0, translateNY: 0, fit: (active?.mediaFit || 'cover') as MediaFit }), [active]);
  const setTx = useCallback((patch: Partial<MediaTransform>) => {
    updateActive(current => ({ mediaTransform: { ...(current.mediaTransform || { scale: 1, translateNX: 0, translateNY: 0, fit: (current.mediaFit || 'cover') as MediaFit }), ...patch } }));
  }, [updateActive]);
  // Backdrop: cut the subject out with the background-removal model behind the
  // Replicate proxy, then let the background layer show through behind them.
  const cutoutSubject = useCallback(async () => {
    if (!active || active.mediaType !== 'image' || !active.localUri) { Alert.alert('Photos only', 'Backdrop cuts the subject out of a photo. Video comes later.'); return; }
    if (cutBusy) return;
    setCutBusy(true);
    try {
      const small = await ImageManipulator.manipulateAsync(active.localUri, [{ resize: { width: 1280 } }], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const { data, error } = await supabase.functions.invoke('replicate-proxy', { body: { op: 'run', model: 'cjwbw/rembg', input: { image: 'data:image/jpeg;base64,' + small.base64 } } });
      if (error) throw error;
      const out = (data as any)?.output;
      const url = typeof out === 'string' ? out : Array.isArray(out) ? out[0] : null;
      if (!url) throw new Error((data as any)?.error || (data as any)?.detail || 'The cutout did not come back.');
      const dest = (FileSystem.cacheDirectory || '') + 'cutout-' + Date.now() + '.png';
      await FileSystem.downloadAsync(url, dest);
      updateActive({ localUri: dest, mediaFit: 'contain' as MediaFit });
      const bg = (getTx() as any).bg;
      if (!bg || bg.kind === 'blur' || bg.kind === 'none') setTx({ bg: { kind: 'gradient', a: '#0B1E3D', b: '#C9BFB0' } } as any);
      setBgOpen(true);
    } catch (e: any) {
      Alert.alert('Backdrop failed', e?.message || 'Try again.');
    } finally { setCutBusy(false); }
  }, [active, cutBusy, updateActive, getTx, setTx]);
  const pushHistory = useCallback(() => { const cur = active?.stickers || []; undoStackRef.current.push(cur.map(s => ({ ...s }))); if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift(); redoStackRef.current = []; setUndoCount(undoStackRef.current.length); setRedoCount(0); }, [active]);
  const updateStickers = useCallback((change: StickerChange) => {
    if (!active?.id) return;
    pushHistory();
    setDrafts(prev => updateDraftStickers(prev, active.id, change));
  }, [active?.id, pushHistory]);
  const drawStrokes: DrawStroke[] = ((active?.stickers || []).find(sx => (sx as any).kind === 'drawing') as any)?.strokes || [];
  const setDrawStrokes = useCallback((strokes: DrawStroke[]) => {
    const cur = active?.stickers || [];
    const others = cur.filter(sx => (sx as any).kind !== 'drawing');
    if (strokes.length === 0) { updateStickers(others); return; }
    const existing: any = cur.find(sx => (sx as any).kind === 'drawing');
    const dSticker: any = existing ? { ...existing, strokes } : { id: newStickerId(), text: '', color: '#FFFFFF', nx: 0.5, ny: 0.5, scale: 1, rotation: 0, kind: 'drawing', strokes };
    updateStickers([...others, dSticker]);
  }, [active, updateStickers]);
  const addSimpleSticker = useCallback((extra: any, nyStart = 0.4) => {
    const st: any = { id: newStickerId(), text: '', color: '#FFFFFF', nx: 0.5, ny: nyStart, scale: 1, rotation: 0, ...extra };
    updateStickers(current => [...current, st]);
  }, [active, updateStickers]);
  const addPhotoSticker = useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.7, allowsMultipleSelection: false });
      const a = res?.assets?.[0];
      if (!a?.uri) return;
      addSimpleSticker({ kind: 'photo', photoUri: a.uri, photoShape: 'rounded' });
    } catch {}
  }, [addSimpleSticker]);
  // Layout: a grid of photo cells placed as photo stickers, each sized as a
  // fraction of the canvas so the same grid replays on the phone viewer and web.
  const applyLayout = useCallback(async (cells: { x: number; y: number; w: number; h: number }[]) => {
    setLayoutOpen(false);
    // The grid drops in as empty cells. Tap any cell to fill it from the
    // library or the camera, so a layout can mix saved and freshly shot photos.
    const gap = 0.012;
    const made = cells.map((c, i) => ({
      id: newStickerId() + '_' + i, text: '', color: '#FFFFFF', scale: 1, rotation: 0, kind: 'photo',
      photoUri: null, photoShape: 'cell', photoFw: Math.max(0.05, c.w - gap), photoFh: Math.max(0.05, c.h - gap),
      nx: c.x + c.w / 2, ny: c.y + c.h / 2,
    }));
    updateStickers([...(active?.stickers || []), ...made] as any);
  }, [active, updateStickers]);
  const setCellPhoto = useCallback((id: string, uri: string | null) => {
    updateStickers(current => current.map(s => s.id === id ? { ...s, photoUri: uri, photoUrl: null } : s));
  }, [active, updateStickers]);
  const fillCellFromLibrary = useCallback(async (id: string) => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.85, allowsMultipleSelection: false });
      const a = res?.assets?.[0]; if (a?.uri) setCellPhoto(id, a.uri);
    } catch {}
  }, [setCellPhoto]);
  const fillCellFromCamera = useCallback(async (id: string) => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Camera off', 'Allow camera access to shoot a photo for this cell.'); return; }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, quality: 0.85 });
      const a = res?.assets?.[0]; if (a?.uri) setCellPhoto(id, a.uri);
    } catch {}
  }, [setCellPhoto]);
  const openCellMenu = useCallback((id: string, hasPhoto: boolean) => {
    Alert.alert('Photo cell', undefined, [
      { text: 'Choose from library', onPress: () => fillCellFromLibrary(id) },
      { text: 'Take a photo', onPress: () => fillCellFromCamera(id) },
      ...(hasPhoto ? [{ text: 'Clear photo', onPress: () => setCellPhoto(id, null) }] : []),
      { text: 'Remove cell', style: 'destructive' as const, onPress: () => updateStickers(((active?.stickers || []) as any[]).filter(s => s.id !== id) as any) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [fillCellFromLibrary, fillCellFromCamera, setCellPhoto, active, updateStickers]);
  const addWeatherSticker = useCallback(async () => {
    let lat: number | null = null, lon: number | null = null;
    try { const Loc = require('expo-location'); const perm = await Loc.requestForegroundPermissionsAsync(); if (perm?.granted) { const pos = await Loc.getLastKnownPositionAsync({}) || await Loc.getCurrentPositionAsync({ accuracy: 3 }); lat = pos?.coords?.latitude ?? null; lon = pos?.coords?.longitude ?? null; } } catch {}
    if (lat == null || lon == null) { try { const r = await fetch('https://ipapi.co/json/'); const j = await r.json(); lat = Number(j?.latitude); lon = Number(j?.longitude); } catch {} }
    if (lat == null || lon == null || Number.isNaN(lat)) { addSimpleSticker({ kind: 'weather', infoStyle: 0 }); return; }
    const w = await fetchWeatherNow(lat, lon);
    addSimpleSticker({ kind: 'weather', infoStyle: 0, weatherTemp: w?.temp, weatherCode: w?.code });
  }, [addSimpleSticker]);
  const handleEntityPick = useCallback((e: EntityPick) => { addSimpleSticker({ kind: 'entity', entityType: e.entityType, entityId: e.entityId, entityTitle: e.entityTitle, entitySub: e.entitySub, entityImage: e.entityImage, ny: 0.62 }); }, [addSimpleSticker]);
  const handleGifPick = useCallback((url: string) => { setGifOpen(false); if (url) addSimpleSticker({ kind: 'gif', gifUrl: url }); }, [addSimpleSticker]);
  const handleSplit = useCallback((segs: { s: number; e: number }[]) => {
    if (!active || segs.length < 2) { setTrimOpen(false); return; }
    setTrimOpen(false);
    setDrafts(prev => {
      const out = [...prev];
      const baseTx = active.mediaTransform || { scale: 1, translateNX: 0, translateNY: 0, fit: (active.mediaFit || 'cover') as MediaFit };
      const cards = segs.map((sg, i) => ({
        ...active,
        id: newDraftId(),
        stickers: i === 0 ? active.stickers : [],
        mediaTransform: { ...baseTx, trimStart: sg.s, trimEnd: sg.e } as MediaTransform,
        durationSec: Math.max(1, Math.round(sg.e - sg.s)),
      }));
      out.splice(activeIndex, 1, ...cards);
      return out;
    });
  }, [active, activeIndex]);
  const saveMediaToDevice = useCallback(async () => {
    try {
      if (!active?.localUri) return;
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Allow Photos access', 'Enable photo library access in Settings to save.'); return; }
      await MediaLibrary.saveToLibraryAsync(active.localUri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Media saved to your device.');
    } catch { Alert.alert('Could not save', 'Something went wrong saving this media.'); }
  }, [active]);
  // Long videos: pre-set a 60s window once so publish is never over-length
  useEffect(() => {
    if (!active || active.mediaType !== 'video') return;
    const d = active.durationSec || 0;
    if (autoTrimSetRef.current.has(active.id)) return;
    const tx: any = active.mediaTransform || {};
    if (tx.trimEnd != null) return;
    // Every video opens the trimmer once, the way Instagram does: long clips
    // get a 60s window pre-set, short ones open on their full length.
    if (d <= 1.2) return;
    autoTrimSetRef.current.add(active.id);
    if (d > STORY_MAX_SEC + 0.5) setTx({ trimStart: 0, trimEnd: STORY_MAX_SEC });
    else if (d > 1.2) setTx({ trimStart: 0, trimEnd: d });
    else return;
  }, [active?.id, active?.durationSec, active?.mediaType, setTx]);

  // Debounce cleanup
  useEffect(() => { return () => { if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current); if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current); }; }, []);

  // ── Undo/Redo ──
  const undo = useCallback(() => { if (undoStackRef.current.length === 0) return; redoStackRef.current.push((active?.stickers || []).map(s => ({ ...s }))); updateActive({ stickers: undoStackRef.current.pop()! }); setUndoCount(undoStackRef.current.length); setRedoCount(redoStackRef.current.length); }, [active, updateActive]);
  const redo = useCallback(() => { if (redoStackRef.current.length === 0) return; undoStackRef.current.push((active?.stickers || []).map(s => ({ ...s }))); updateActive({ stickers: redoStackRef.current.pop()! }); setUndoCount(undoStackRef.current.length); setRedoCount(redoStackRef.current.length); }, [active, updateActive]);

  // ── Draft management ──
  const removeDraft = useCallback((index: number) => { setDrafts(prev => { const next = prev.filter((_, i) => i !== index); if (next.length === 0) { setActiveIndex(0); return next; } if (activeIndex >= next.length) setActiveIndex(next.length - 1); else if (activeIndex > index) setActiveIndex(activeIndex - 1); return next; }); }, [activeIndex]);
  const addClips = useCallback(async () => {
    if (addingClipsRef.current || publish.publishing || latestDrafts.current.length >= STORY_CLIP_LIMIT) return;
    const owner = ownerRef.current;
    addingClipsRef.current = true; setAddingClips(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, orderedSelection: true, selectionLimit: STORY_CLIP_LIMIT - latestDrafts.current.length, quality: 1, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled || !mountedRef.current || owner !== ownerRef.current) return;
      const slots = STORY_CLIP_LIMIT - latestDrafts.current.length;
      const added: Draft[] = result.assets.slice(0, slots).map(asset => {
        const item = normalizeStoryCapture(asset);
        return { id: newDraftId(), localUri: item.localUri, thumbnailUri: null, mediaType: item.mediaType, durationSec: item.durationSec, caption: '', scope: 'global', audience, allowReplies, sharedWith: active?.sharedWith || null, reach, uploadState: 'idle', pollData: null, stickers: [], imageW: item.width, imageH: item.height, mediaFit: 'cover', mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover' }, category: null, textBgId: 'navy', textBackground: null };
      });
      if (added.length) { setActiveIndex(latestDrafts.current.length); setDrafts(current => [...current, ...added].slice(0, STORY_CLIP_LIMIT)); undoStackRef.current = []; redoStackRef.current = []; setUndoCount(0); setRedoCount(0); }
    } catch (error: any) { if (mountedRef.current && owner === ownerRef.current) Alert.alert('Could not add clips', error?.message || 'Try selecting your photos and videos again.'); }
    finally { addingClipsRef.current = false; if (mountedRef.current) setAddingClips(false); }
  }, [active?.sharedWith, audience, allowReplies, reach, publish.publishing]);
  const handleFitToggle = useCallback(() => { if (!active) return; const nf: MediaFit = (active.mediaFit || 'cover') === 'cover' ? 'contain' : 'cover'; updateActive({ mediaFit: nf, mediaTransform: { ...active.mediaTransform, scale: 1, translateNX: 0, translateNY: 0, fit: nf } }); }, [active, updateActive]);
  const handleTransformChange = useCallback((t: MediaTransform) => { updateActive({ mediaTransform: t }); }, [updateActive]);
  const nextStickerNy = useCallback((base: number = 0.4) => { const c = active?.stickers?.length ?? 0; return c === 0 ? base : Math.min(0.76, base + c * 0.12); }, [active]);

  // ── Text editor ──
  const openTextEditor = useCallback((existingId?: string) => {
    setTextPanel('font');
    if (existingId && active?.stickers) { const ex = active.stickers.find(s => s.id === existingId); if (ex) { setEditingStickerId(existingId); setStickerText(ex.text); setStickerStyle(ex.style); setStickerColor(ex.color); setStickerBgEnabled(!!ex.bgEnabled); setStickerFontSize(ex.fontSizeOverride ?? 0); setStickerOpacity(ex.opacity ?? 1.0); setStickerTextAlign(ex.textAlign ?? 'center'); setStickerAnim((ex as any).anim || 'none'); setStickerStartSec(typeof (ex as any).startSec === 'number' ? (ex as any).startSec : null); setStickerEndSec(typeof (ex as any).endSec === 'number' ? (ex as any).endSec : null); setTextEditorOpen(true); const si = STICKER_STYLES.indexOf(ex.style); if (si > 0) setTimeout(() => stylePickerRef.current?.scrollTo({ x: si * 72, animated: false }), 100); setTimeout(() => stickerInputRef.current?.focus(), 200); return; } }
    if ((active?.stickers?.length ?? 0) >= MAX_STICKERS) { Alert.alert('Limit reached', `Maximum ${MAX_STICKERS} text overlays per story.`); return; }
    setEditingStickerId(null); setStickerText(''); setStickerStyle('classic'); setStickerColor(active?.mediaType === 'text' ? getDefaultStickerColor(active.textBgId) : '#FFFFFF'); setStickerBgEnabled(false); setStickerFontSize(0); setStickerOpacity(1.0); setStickerTextAlign('center'); setStickerAnim('none'); setStickerStartSec(null); setStickerEndSec(null); setTextEditorOpen(true); setTimeout(() => stickerInputRef.current?.focus(), 200);
  }, [active]);
  const closeTextEditor = useCallback(() => { Keyboard.dismiss(); setTextEditorOpen(false); setStickerText(''); setEditingStickerId(null); }, []);
  // A typed @handle inside a text sticker is a real mention: the person is notified and can add the story to theirs
  // (through the hidden-mention path the composer already has), and the handle opens their profile in the viewer.
  const resolveTextMentions = useCallback(async (stickerId: string, text: string) => {
    const draftId = active?.id;
    if (!draftId) return;
    const handles = storyHandles(text);
    let found: { id: string; username: string }[] = [];
    if (handles.length) {
      try {
        const { data } = await supabase.from('profiles').select('id, username').in('username', handles);
        found = ((data || []) as any[]).filter(p => p.username).map(p => ({ id: p.id, username: String(p.username) }));
      } catch {}
    }
    if (!mountedRef.current) return;
    setDrafts(prev => prev.map(d => {
      if (d.id !== draftId || d.uploadState === 'uploading' || d.uploadState === 'done' || !d.stickers?.some(s => s.id === stickerId && s.text === text)) return d;
      const stickers = (d.stickers || []).map(s => (s.id === stickerId ? ({ ...s, mentions: found.length ? found : undefined } as any) : s));
      return { ...d, stickers } as any;
    }));
  }, [active?.id]);
  const saveSticker = useCallback(() => {
    const tr = stickerText.trim(); if (!tr) { if (editingStickerId) updateStickers((active?.stickers || []).filter(s => s.id !== editingStickerId)); closeTextEditor(); return; }
    const timing = storyLayerWindow(stickerStartSec, stickerEndSec, active?.durationSec || 15);
    const extra: any = { bgEnabled: stickerBgEnabled, fontSizeOverride: stickerFontSize > 0 ? stickerFontSize : undefined, opacity: stickerOpacity < 1.0 ? stickerOpacity : undefined, textAlign: stickerTextAlign !== 'center' ? stickerTextAlign : undefined, anim: stickerAnim !== 'none' ? stickerAnim : undefined, startSec: stickerStartSec != null ? timing.start : undefined, endSec: stickerEndSec != null ? timing.end : undefined };
    if (editingStickerId) { updateStickers((active?.stickers || []).map(s => s.id === editingStickerId ? { ...s, text: tr, style: stickerStyle, color: stickerColor, ...extra } : s)); void resolveTextMentions(editingStickerId, tr); }
    else { const nid = newStickerId(); updateStickers([...(active?.stickers || []), { id: nid, text: tr, style: stickerStyle, color: stickerColor, nx: 0.5, ny: nextStickerNy(0.4), scale: 1, rotation: 0, ...extra }]); void resolveTextMentions(nid, tr); }
    closeTextEditor();
  }, [stickerText, stickerStyle, stickerColor, stickerBgEnabled, stickerFontSize, stickerOpacity, stickerTextAlign, stickerAnim, stickerStartSec, stickerEndSec, editingStickerId, active, updateStickers, closeTextEditor, nextStickerNy, resolveTextMentions]);
  const deleteEditingSticker = useCallback(() => { if (!editingStickerId) return; updateStickers((active?.stickers || []).filter(s => s.id !== editingStickerId)); closeTextEditor(); }, [editingStickerId, active, updateStickers, closeTextEditor]);

  // ── Emoji ──
  const openEmojiTray = useCallback((existingId?: string) => { if (existingId && active?.stickers) { const ex = active.stickers.find(s => s.id === existingId); if (ex?.kind === 'emoji') { setEditingEmojiStickerId(existingId); setEmojiTrayOpen(true); return; } } if ((active?.stickers?.length ?? 0) >= MAX_STICKERS) { Alert.alert('Limit reached', `Maximum ${MAX_STICKERS} stickers.`); return; } setEditingEmojiStickerId(null); setEmojiTrayOpen(true); }, [active]);
  const closeEmojiTray = useCallback(() => { setEmojiTrayOpen(false); setEditingEmojiStickerId(null); }, []);
  const selectEmoji = useCallback((emoji: string) => { if (editingEmojiStickerId) { updateStickers((active?.stickers || []).map(s => s.id === editingEmojiStickerId ? { ...s, text: emoji } : s)); } else { updateStickers([...(active?.stickers || []), { id: newStickerId(), kind: 'emoji', text: emoji, style: 'classic' as StoryStickerStyle, color: '#FFFFFF', nx: 0.5, ny: nextStickerNy(0.4), scale: 1.5, rotation: 0 }]); } closeEmojiTray(); }, [editingEmojiStickerId, active, updateStickers, closeEmojiTray, nextStickerNy]);
  const deleteEditingEmoji = useCallback(() => { if (!editingEmojiStickerId) return; updateStickers((active?.stickers || []).filter(s => s.id !== editingEmojiStickerId)); closeEmojiTray(); }, [editingEmojiStickerId, active, updateStickers, closeEmojiTray]);
  const duplicateSticker = useCallback((id: string) => { const stk = active?.stickers || []; const idx = stk.findIndex(s => s.id === id); if (idx === -1 || stk.length >= MAX_STICKERS) return; const o = stk[idx]; const u = [...stk]; u.splice(idx + 1, 0, { ...o, id: newStickerId(), nx: Math.min(0.9, o.nx + 0.05), ny: Math.min(0.9, o.ny + 0.05) }); updateStickers(u); closeTextEditor(); closeEmojiTray(); }, [active, updateStickers, closeTextEditor, closeEmojiTray]);
  const bringForward = useCallback((id: string) => { const stk = active?.stickers || []; const i = stk.findIndex(s => s.id === id); if (i === -1 || i >= stk.length - 1) return; const u = [...stk]; [u[i], u[i+1]] = [u[i+1], u[i]]; updateStickers(u); }, [active, updateStickers]);
  const sendBackward = useCallback((id: string) => { const stk = active?.stickers || []; const i = stk.findIndex(s => s.id === id); if (i <= 0) return; const u = [...stk]; [u[i], u[i-1]] = [u[i-1], u[i]]; updateStickers(u); }, [active, updateStickers]);

  // ── Sticker interaction handlers ──
  const handleTapSticker = useCallback((id: string) => { if (publish.publishing) return; const s = active?.stickers?.find(x => x.id === id); if (!s) return; if (s.kind === 'photo' && (s as any).photoShape === 'cell') openCellMenu(id, !!((s as any).photoUri || (s as any).photoUrl));
    else if (s.kind === 'emoji') openEmojiTray(id); else if (s.kind === 'question') openQuestionModal(id); else if (s.kind === 'slider') openSliderModal(id); else if (s.kind === 'quiz') openQuizModal(id); else if ((s as any).kind === 'photo') { const shapes = PHOTO_SHAPES as any; const cur = shapes.indexOf((s as any).photoShape || 'rounded'); updateStickers((active?.stickers || []).map(x => x.id === id ? ({ ...x, photoShape: shapes[(cur + 1) % shapes.length] } as any) : x)); } else if ((s as any).kind === 'time' || (s as any).kind === 'date' || (s as any).kind === 'weather') { const mod = (s as any).kind === 'time' ? TIME_STYLES : (s as any).kind === 'date' ? DATE_STYLES : WEATHER_STYLES; updateStickers((active?.stickers || []).map(x => x.id === id ? ({ ...x, infoStyle: (((x as any).infoStyle || 0) + 1) % mod } as any) : x)); } else if (s.kind === 'link' || s.kind === 'location' || s.kind === 'mention' || s.kind === 'hashtag') { updateStickers((active?.stickers || []).map(x => x.id === id ? ({ ...x, pillVariant: (((x as any).pillVariant || 0) + 1) % 4 } as any) : x)); } else if ((s as any).kind === 'gif' || (s as any).kind === 'entity' || (s as any).kind === 'drawing') { /* no editor */ } else openTextEditor(id); }, [publish.publishing, active]);
  const handleDragEnd = useCallback((id: string, nx: number, ny: number) => { updateStickers(current => current.map(s => s.id === id ? { ...s, nx, ny } : s)); }, [active, updateStickers]);
  const handleScaleEnd = useCallback((id: string, ns: number) => { updateStickers(current => current.map(s => s.id === id ? { ...s, scale: ns } : s)); }, [active, updateStickers]);
  const handleRotateEnd = useCallback((id: string, nr: number) => { updateStickers(current => current.map(s => s.id === id ? { ...s, rotation: nr } : s)); }, [active, updateStickers]);
  const handleDeleteDrop = useCallback((id: string) => { updateStickers(current => current.filter(s => s.id !== id)); }, [active, updateStickers]);

  // ── Poll ──
  const openPollEditor = useCallback(() => { if (active?.pollData) { setPollQuestion(active.pollData.question); setPollOptions([...active.pollData.options]); } else { setPollQuestion(''); setPollOptions(['', '']); } setPollEditorOpen(true); }, [active]);
  const closePollEditor = useCallback(() => setPollEditorOpen(false), []);
  const addPollOption = useCallback(() => { if (pollOptions.length < 4) setPollOptions(p => [...p, '']); }, [pollOptions.length]);
  const removePollOption = useCallback((i: number) => { if (pollOptions.length <= 2) return; setPollOptions(p => p.filter((_, idx) => idx !== i)); }, [pollOptions.length]);
  const updatePollOption = useCallback((i: number, t: string) => { setPollOptions(p => p.map((o, idx) => idx === i ? t : o)); }, []);
  const savePoll = useCallback(() => { const q = pollQuestion.trim(); if (!q) { Alert.alert('Missing question', 'Enter a poll question.'); return; } if (q.length > 120) { Alert.alert('Question too long', 'Keep under 120 characters.'); return; } const opts = pollOptions.map(o => o.trim()).filter(o => o.length > 0); if (opts.length < 2) { Alert.alert('Not enough options', 'Add at least 2.'); return; } for (const o of opts) { if (o.length > 40) { Alert.alert('Option too long', 'Keep under 40 characters.'); return; } } const ls = new Set<string>(); for (const o of opts) { const l = o.toLowerCase(); if (ls.has(l)) { Alert.alert('Duplicate', `"${o}" appears twice.`); return; } ls.add(l); } updateActive({ pollData: { ...(active?.pollData || {}), question: q, options: opts } }); setPollEditorOpen(false); }, [pollQuestion, pollOptions, updateActive]);
  const removePoll = useCallback(() => { updateActive({ pollData: null }); }, [updateActive]);

  // ── Link ──
  const openLinkModal = useCallback(() => { setLinkLabel(''); setLinkUrl(''); setLinkModalOpen(true); }, []);
  const closeLinkModal = useCallback(() => { setLinkModalOpen(false); }, []);
  const isValidUrl = (s: string) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
  const addLinkSticker = useCallback(() => { const l = linkLabel.trim(); const u = linkUrl.trim(); if (!l || !u || !isValidUrl(u)) return; updateStickers([...(active?.stickers || []), { id: newStickerId(), text: l, style: 'classic' as StoryStickerStyle, color: '#FFFFFF', nx: 0.5, ny: 0.5, scale: 1, rotation: 0, kind: 'link', url: u }]); closeLinkModal(); }, [linkLabel, linkUrl, active, updateStickers, closeLinkModal]);

  // ── Location ──
  const openLocationModal = useCallback(() => { setLocationSearch(''); setLocationResults([]); setLocationError(false); setLocationModalOpen(true); }, []);
  const closeLocationModal = useCallback(() => { setLocationModalOpen(false); setLocationSearch(''); setLocationResults([]); if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current); }, []);
  const searchLocations = useCallback(async (q: string) => { const t = q.trim(); if (t.length < 3) { setLocationResults([]); setLocationLoading(false); return; } setLocationLoading(true); setLocationError(false); try { const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(t)}&format=json&addressdetails=1&limit=8`); if (!r.ok) throw new Error(`HTTP ${r.status}`); setLocationResults(await r.json() || []); } catch { setLocationError(true); setLocationResults([]); } finally { setLocationLoading(false); } }, []);
  const onLocationSearchChange = useCallback((t: string) => { setLocationSearch(t); setLocationError(false); if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current); locationDebounceRef.current = setTimeout(() => searchLocations(t), 700); }, [searchLocations]);
  const fmtLoc = (item: any) => { const name = item.name || item.display_name?.split(',')[0] || 'Unknown'; const addr = item.address || {}; const parts = [addr.city || addr.town || addr.village, addr.state, addr.country].filter(Boolean); return { name, subtitle: parts.join(', ') || (item.display_name?.split(',').slice(1, 3).join(',').trim()) || '' }; };
  const addLocationSticker = useCallback((item: any) => { const { name } = fmtLoc(item); updateStickers([...(active?.stickers || []), { id: newStickerId(), text: name, style: 'classic' as StoryStickerStyle, color: '#FFFFFF', nx: 0.5, ny: 0.45, scale: 1, rotation: 0, kind: 'location', locationName: name, locationDisplayName: item.display_name || name, locationLat: parseFloat(item.lat) || undefined, locationLng: parseFloat(item.lon) || undefined, locationPlaceId: item.place_id ? String(item.place_id) : undefined }]); closeLocationModal(); }, [active, updateStickers, closeLocationModal]);

  // ── Mention ──
  const loadMentionDefaults = useCallback(async () => {
    const version = ++mentionSearchVersion.current; setMentionLoading(true);
    try {
      const { data, error } = await supabase.from('profiles').select('id, full_name, username, avatar_url, is_verified, verified_tier').neq('id', myId || '').order('last_seen', { ascending: false, nullsFirst: false }).limit(30);
      if (version === mentionSearchVersion.current && mountedRef.current) setMentionResults(error ? [] : data || []);
    } catch { if (version === mentionSearchVersion.current && mountedRef.current) setMentionResults([]); }
    finally { if (version === mentionSearchVersion.current && mountedRef.current) setMentionLoading(false); }
  }, [myId]);
  const openMentionModal = useCallback(() => { setMentionSearch(''); setMentionResults([]); setMentionModalOpen(true); void loadMentionDefaults(); }, [loadMentionDefaults]);
  const closeMentionModal = useCallback(() => { mentionSearchVersion.current++; setMentionModalOpen(false); setMentionSearch(''); setMentionResults([]); setMentionLoading(false); setMentionPicks([]); setMentionHidden(false); if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current); }, []);
  const searchUsers = useCallback(async (q: string) => {
    const c = q.trim().replace(/^@/, '').replace(/[^A-Za-z0-9_. -]/g, '').toLowerCase().slice(0, 60);
    if (c.length < 2) { void loadMentionDefaults(); return; }
    const version = ++mentionSearchVersion.current; setMentionLoading(true);
    try {
      const { data, error } = await supabase.from('profiles').select('id, full_name, username, avatar_url, is_verified, verified_tier').or(`username.ilike.%${c}%,full_name.ilike.%${c}%`).neq('id', myId || '').limit(10);
      if (version === mentionSearchVersion.current && mountedRef.current) setMentionResults(error ? [] : data || []);
    } catch { if (version === mentionSearchVersion.current && mountedRef.current) setMentionResults([]); }
    finally { if (version === mentionSearchVersion.current && mountedRef.current) setMentionLoading(false); }
  }, [myId, loadMentionDefaults]);
  const onMentionSearchChange = useCallback((t: string) => { mentionSearchVersion.current++; setMentionSearch(t); setMentionResults([]); if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current); mentionDebounceRef.current = setTimeout(() => void searchUsers(t), 250); }, [searchUsers]);
  const toggleMentionPick = useCallback((u: any) => { setMentionPicks(prev => prev.some(p => p.id === u.id) ? prev.filter(p => p.id !== u.id) : [...prev, u]); }, []);
  const confirmMentions = useCallback(() => {
    const picks = mentionPicks;
    if (picks.length > 0) {
      if (mentionHidden) {
        // Hidden mention: a backend relationship only. Nothing is drawn on the
        // story; the person is notified and can reshare if allowed.
        const cur = ((active as any)?.hiddenMentions || []) as { id: string; username: string }[];
        const add = picks.filter(u => !cur.some(h => h.id === u.id)).map(u => ({ id: u.id, username: u.username || u.full_name || 'member' }));
        if (add.length > 0) updateActive({ hiddenMentions: [...cur, ...add] } as any);
      } else {
        const existing = (active?.stickers || []) as any[];
        const fresh = picks.filter(u => !existing.some(s => s.kind === 'mention' && s.mentionUserId === u.id));
        const made = fresh.map((u, i) => ({ id: newStickerId(), text: `@${u.username || u.full_name}`, style: 'classic' as StoryStickerStyle, color: '#FFFFFF', nx: 0.5, ny: Math.min(0.82, 0.5 + i * 0.075), scale: 1, rotation: 0, kind: 'mention', mentionUserId: u.id, mentionUsername: u.username || u.full_name }));
        if (made.length > 0) updateStickers([...existing, ...made] as any);
      }
    }
    closeMentionModal();
  }, [mentionPicks, mentionHidden, active, updateActive, updateStickers, closeMentionModal]);
  const removeHiddenMention = useCallback((id: string) => { const cur = ((active as any)?.hiddenMentions || []) as { id: string; username: string }[]; updateActive({ hiddenMentions: cur.filter(h => h.id !== id) } as any); }, [active, updateActive]);

  // ── Hashtag ──
  // No search and no external service: a hashtag is just text, and forcing a
  // picker on it would be slower than typing. Tapping it in the viewer opens
  // search for that tag, which is what makes it worth having over plain text.
  const openHashtagModal = useCallback(() => {
    if ((active?.stickers?.length ?? 0) >= MAX_STICKERS) return;
    setHashtagText('');
    setHashtagModalOpen(true);
  }, [active]);
  const closeHashtagModal = useCallback(() => { setHashtagModalOpen(false); setHashtagText(''); }, []);
  const addHashtagSticker = useCallback(() => {
    const raw = hashtagText.trim().replace(/^#/, '');
    const tag = raw.replace(/[^A-Za-z0-9_]/g, '');
    if (!tag) { Alert.alert('Required', 'Enter a hashtag.'); return; }
    if (tag.length > 30) { Alert.alert('Too long', 'Keep hashtags under 30 characters.'); return; }
    updateStickers([...(active?.stickers || []), {
      id: newStickerId(), text: `#${tag}`, style: 'classic' as StoryStickerStyle,
      color: '#FFFFFF', nx: 0.5, ny: 0.5, scale: 1, rotation: 0,
      kind: 'hashtag', hashtag: tag,
    }]);
    closeHashtagModal();
  }, [hashtagText, active, updateStickers, closeHashtagModal]);
  // -- Countdown --
  const openCountdownModal = useCallback(() => {
    if ((active?.stickers?.length ?? 0) >= MAX_STICKERS) return;
    setCdTitle('');
    setCdTarget(new Date(Date.now() + 24 * 3600 * 1000));
    setCountdownModalOpen(true);
  }, [active]);
  const cdShift = useCallback((ms: number) => { setCdTarget(prev => { const next = new Date(Math.max(Date.now() + 5 * 60000, prev.getTime() + ms)); return next; }); }, []);
  const cdPreset = useCallback((kind: string) => {
    const now = new Date();
    let next = new Date(now.getTime() + 3600 * 1000);
    if (kind === '3h') next = new Date(now.getTime() + 3 * 3600 * 1000);
    if (kind === 'tonight') { next = new Date(now); next.setHours(20, 0, 0, 0); if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1); }
    if (kind === 'tomorrow') { next = new Date(now); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0); }
    if (kind === '3d') next = new Date(now.getTime() + 3 * 86400 * 1000);
    if (kind === '1w') next = new Date(now.getTime() + 7 * 86400 * 1000);
    setCdTarget(next);
  }, []);
  const addCountdownSticker = useCallback(() => {
    const t = cdTitle.trim();
    if (!t) { Alert.alert('Required', 'Give your countdown a title.'); return; }
    if (t.length > 60) { Alert.alert('Too long', 'Keep it under 60 characters.'); return; }
    if (cdTarget.getTime() <= Date.now() + 60000) { Alert.alert('Too soon', 'Pick a time at least a minute away.'); return; }
    updateStickers([...(active?.stickers || []), {
      id: newStickerId(), text: t, style: 'classic' as StoryStickerStyle,
      color: '#FFFFFF', nx: 0.5, ny: 0.4, scale: 1, rotation: 0,
      kind: 'countdown', countdownTitle: t, countdownTarget: cdTarget.toISOString(),
    }]);
    setCountdownModalOpen(false);
  }, [cdTitle, cdTarget, active, updateStickers]);
  // ── Question ──
  const openQuestionModal = useCallback((existingId?: string) => { if (existingId && active?.stickers) { const ex = active.stickers.find(s => s.id === existingId && s.kind === 'question'); if (ex) { setEditingQuestionId(existingId); setQuestionPrompt(ex.questionPrompt || ex.text || ''); setQuestionModalOpen(true); return; } } if ((active?.stickers?.length ?? 0) >= MAX_STICKERS) return; setEditingQuestionId(null); setQuestionPrompt(''); setQuestionModalOpen(true); }, [active]);
  const saveQuestion = useCallback(() => { const t = questionPrompt.trim(); if (!t || t.length > 120) { Alert.alert(t ? 'Too long' : 'Required', t ? 'Keep under 120.' : 'Enter a prompt.'); return; } if (editingQuestionId) { updateStickers((active?.stickers || []).map(s => s.id === editingQuestionId ? { ...s, text: t, questionPrompt: t } : s)); } else { updateStickers([...(active?.stickers || []), { id: newStickerId(), text: t, style: 'classic' as StoryStickerStyle, color: '#FFFFFF', nx: 0.5, ny: 0.4, scale: 1, rotation: 0, kind: 'question', questionPrompt: t }]); } setQuestionModalOpen(false); setQuestionPrompt(''); setEditingQuestionId(null); }, [questionPrompt, editingQuestionId, active, updateStickers]);

  // ── Slider ──
  const openSliderModal = useCallback((existingId?: string) => { if (existingId && active?.stickers) { const ex = active.stickers.find(s => s.id === existingId && s.kind === 'slider'); if (ex) { setEditingSliderId(existingId); setSliderLabel(ex.sliderLabel || ex.text || ''); setSliderEmoji(ex.sliderEmoji || '❤️'); setSliderModalOpen(true); return; } } if ((active?.stickers?.length ?? 0) >= MAX_STICKERS) return; setEditingSliderId(null); setSliderLabel(''); setSliderEmoji('❤️'); setSliderModalOpen(true); }, [active]);
  const saveSlider = useCallback(() => { const t = sliderLabel.trim(); if (!t || t.length > 80) { Alert.alert(t ? 'Too long' : 'Required', t ? 'Under 80.' : 'Enter a label.'); return; } const em = (sliderEmoji.trim() || '❤️').slice(0, 4); if (editingSliderId) { updateStickers((active?.stickers || []).map(s => s.id === editingSliderId ? { ...s, text: t, sliderLabel: t, sliderEmoji: em } : s)); } else { updateStickers([...(active?.stickers || []), { id: newStickerId(), text: t, style: 'classic' as StoryStickerStyle, color: '#FFFFFF', nx: 0.5, ny: 0.45, scale: 1, rotation: 0, kind: 'slider', sliderLabel: t, sliderEmoji: em }]); } setSliderModalOpen(false); setSliderLabel(''); setSliderEmoji('❤️'); setEditingSliderId(null); }, [sliderLabel, sliderEmoji, editingSliderId, active, updateStickers]);

  // ── Quiz ──
  const openQuizModal = useCallback((existingId?: string) => { if (existingId && active?.stickers) { const ex = active.stickers.find(s => s.id === existingId && s.kind === 'quiz'); if (ex?.quizOptions) { setEditingQuizId(existingId); setQuizQuestion(ex.quizQuestion || ex.text || ''); setQuizOptions(ex.quizOptions.map(o => ({ ...o }))); setQuizModalOpen(true); return; } } if ((active?.stickers?.length ?? 0) >= MAX_STICKERS) return; setEditingQuizId(null); setQuizQuestion(''); setQuizOptions([{ id: `o_${Date.now()}_0`, label: '', isCorrect: false }, { id: `o_${Date.now()}_1`, label: '', isCorrect: false }]); setQuizModalOpen(true); }, [active]);
  const addQuizOption = useCallback(() => { if (quizOptions.length >= 4) return; setQuizOptions(p => [...p, { id: `o_${Date.now()}_${p.length}`, label: '', isCorrect: false }]); }, [quizOptions.length]);
  const removeQuizOption = useCallback((i: number) => { if (quizOptions.length <= 2) return; setQuizOptions(p => p.filter((_, idx) => idx !== i)); }, [quizOptions.length]);
  const saveQuiz = useCallback(() => { const q = quizQuestion.trim(); if (!q || q.length > 120) { Alert.alert(q ? 'Too long' : 'Required', q ? 'Under 120.' : 'Enter a question.'); return; } const vo = quizOptions.map(o => ({ ...o, label: o.label.trim() })).filter(o => o.label.length > 0); if (vo.length < 2) { Alert.alert('Not enough', 'At least 2 options.'); return; } if (vo.filter(o => o.isCorrect).length !== 1) { Alert.alert('Select answer', 'Mark exactly one correct.'); return; } const ls = new Set<string>(); for (const o of vo) { const l = o.label.toLowerCase(); if (ls.has(l)) { Alert.alert('Duplicate', `"${o.label}" twice.`); return; } ls.add(l); } if (editingQuizId) { updateStickers((active?.stickers || []).map(s => s.id === editingQuizId ? { ...s, text: q, quizQuestion: q, quizOptions: vo } : s)); } else { updateStickers([...(active?.stickers || []), { id: newStickerId(), text: q, style: 'classic' as StoryStickerStyle, color: '#FFFFFF', nx: 0.5, ny: 0.35, scale: 1, rotation: 0, kind: 'quiz', quizQuestion: q, quizOptions: vo }]); } setQuizModalOpen(false); setQuizQuestion(''); setQuizOptions([]); setEditingQuizId(null); }, [quizQuestion, quizOptions, editingQuizId, active, updateStickers]);

  // ── Add Yours, Notify, Magic ball, Support, Frame ──
  const [stickerForm, setStickerForm] = useState<null | { kind: 'addyours' | 'notify' | 'magic' | 'support'; a: string; b: string; days: number }>(null);
  const AY_TEMPLATES = ['A photo from this week', 'My morning view', 'Something that made me smile', 'My workspace right now', 'Last thing I cooked', 'A song on repeat'];
  const saveStickerForm = useCallback(() => {
    if (!stickerForm) return;
    const a = stickerForm.a.trim(); const b = stickerForm.b.trim();
    if (!a) { Alert.alert('Required', 'Give it a title.'); return; }
    if (stickerForm.kind === 'addyours') addSimpleSticker({ kind: 'addyours', text: a, addYoursPrompt: a, addYoursOriginStoryId: null, addYoursOriginStickerId: null }, 0.25);
    if (stickerForm.kind === 'support') { if (!b) { Alert.alert('Required', 'Add the link people should open.'); return; } addSimpleSticker({ kind: 'support', text: a, supportTitle: a, supportUrl: b }, 0.6); }
    setStickerForm(null);
  }, [stickerForm, addSimpleSticker]);
  // ── Derived state ──
  const canPublish = publish.canPublish;
  const hasPoll = !!active?.pollData;
  const isTextStory = active?.mediaType === 'text';
  const stickerCounts = useMemo(() => { const st = active?.stickers || []; return { addyours: st.filter(s => s.kind === 'addyours').length, support: st.filter(s => s.kind === 'support').length, text: st.filter(s => !s.kind || s.kind === 'text').length, emoji: st.filter(s => s.kind === 'emoji').length, link: st.filter(s => s.kind === 'link').length, location: st.filter(s => s.kind === 'location').length, mention: st.filter(s => s.kind === 'mention').length, hashtag: st.filter(s => s.kind === 'hashtag').length, question: st.filter(s => s.kind === 'question').length, slider: st.filter(s => s.kind === 'slider').length, quiz: st.filter(s => s.kind === 'quiz').length, countdown: st.filter(s => s.kind === 'countdown').length, entity: st.filter(s => (s as any).kind === 'entity').length, gif: st.filter(s => (s as any).kind === 'gif').length, photo: st.filter(s => (s as any).kind === 'photo').length, time: st.filter(s => (s as any).kind === 'time').length, date: st.filter(s => (s as any).kind === 'date').length, weather: st.filter(s => (s as any).kind === 'weather').length }; }, [active?.stickers]);

  // ── Empty state ──
  if (drafts.length === 0) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" />
      {myId && <SaveToMemorySheet visible={publishedStoryIds.length > 0} storyIds={publishedStoryIds} userId={myId} onClose={finishPublishing} />}
        <View style={st.emptyFallback}>
          <Feather name="image" size={40} color={accent.warmMuted} />
          <Text style={st.emptyFallbackTitle}>No media selected</Text>
          <Text style={st.emptyFallbackSub}>Go back and choose a photo or video.</Text>
          <TouchableOpacity style={st.emptyFallbackBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Feather name="arrow-left" size={16} color="#FFF" />
            <Text style={st.emptyFallbackBtnTxt}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Helpers ──
  const renderTextBg = (bg: StoryTextBackground | null, style?: any) => {
    if (bg?.kind === 'gradient' && (bg as any).colors?.length === 2) {
      return <LinearGradient colors={(bg as any).colors} start={(bg as any).direction === 'diagonal' ? { x: 0, y: 0 } : { x: 0.5, y: 0 }} end={(bg as any).direction === 'diagonal' ? { x: 1, y: 1 } : { x: 0.5, y: 1 }} style={style || StyleSheet.absoluteFill} />;
    }
    return <View style={[style || StyleSheet.absoluteFill, { backgroundColor: (bg as any)?.color || '#0B1E3D' }]} />;
  };


  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════

  const studioTiles: StudioTile[] = [
    { id: 'poll', cat: 'interactive', tint: '#8B5CF6', icon: 'bar-chart-2', label: hasPoll ? 'Edit poll' : 'Poll', on: hasPoll, run: openPollEditor },
    { id: 'question', cat: 'interactive', tint: '#38BDF8', icon: 'help-circle', label: 'Question', on: stickerCounts.question > 0, run: () => openQuestionModal() },
    { id: 'quiz', cat: 'interactive', tint: '#34D399', icon: 'check-square', label: 'Quiz', on: stickerCounts.quiz > 0, run: () => openQuizModal() },
    { id: 'slider', cat: 'interactive', tint: '#FB923C', icon: 'sliders', label: 'Slider', on: stickerCounts.slider > 0, run: () => openSliderModal() },
    { id: 'addyours', cat: 'interactive', tint: '#C9BFB0', icon: 'addyours', label: 'Add yours', on: stickerCounts.addyours > 0, run: () => setStickerForm({ kind: 'addyours', a: '', b: '', days: 0 }) },
    { id: 'support', cat: 'sharing', tint: '#FF7A90', icon: 'support', label: 'Support', on: stickerCounts.support > 0, run: () => setStickerForm({ kind: 'support', a: '', b: '', days: 0 }) },
    { id: 'countdown', cat: 'interactive', tint: '#F59E0B', icon: 'countdown', label: 'Countdown', on: stickerCounts.countdown > 0, run: openCountdownModal },
    { id: 'mention', cat: 'sharing', tint: '#60A5FA', icon: 'at-sign', label: 'Mention', on: stickerCounts.mention > 0, run: openMentionModal },
    { id: 'hashtag', cat: 'sharing', tint: '#A78BFA', icon: 'hash', label: 'Hashtag', on: stickerCounts.hashtag > 0, run: openHashtagModal },
    { id: 'location', cat: 'sharing', tint: '#F472B6', icon: 'map-pin', label: 'Location', on: stickerCounts.location > 0, run: openLocationModal },
    { id: 'link', cat: 'sharing', tint: '#7DD3FC', icon: 'link', label: 'Link', on: stickerCounts.link > 0, run: openLinkModal },
    { id: 'emoji', cat: 'fun', tint: '#FBBF24', icon: 'smile', label: 'Emoji', on: stickerCounts.emoji > 0, run: () => openEmojiTray() },
    { id: 'music', cat: 'media', tint: '#F472B6', icon: 'music', label: 'Music', on: !!active?.audio, run: openMusicSheet },
    { id: 'filter', cat: 'media', tint: '#818CF8', icon: 'droplet', label: 'Filter', on: !!active?.filterId, run: openFilterSheet },
    { id: 'trim', cat: 'media', tint: '#F59E0B', icon: 'trim', label: 'Trim', on: (getTx() as any).trimEnd != null, run: () => { if (active?.mediaType !== 'video') { Alert.alert('Video only', 'Trim works on video stories.'); return; } setTrimOpen(true); } },
    { id: 'adjust', cat: 'media', tint: '#34D399', icon: 'adjust', label: 'Adjust', on: !!(getTx() as any).adjust || (getTx() as any).filterAmt != null, run: () => setAdjustOpen(true) },
    { id: 'draw', cat: 'media', tint: '#FB7185', icon: 'draw', label: 'Draw', on: drawStrokes.length > 0, run: () => setDrawMode(true) },
    { id: 'bg', cat: 'media', tint: '#60A5FA', icon: 'bg', label: 'Background', on: !!(getTx() as any).bg, run: () => { if ((active?.mediaFit || 'cover') !== 'contain') { Alert.alert('Fit first', 'Backgrounds show around media in fit mode. Tap the fit toggle, then pick a background.'); } setBgOpen(true); } },
    { id: 'mix', cat: 'media', tint: '#A78BFA', icon: 'mix', label: 'Sound mix', on: !!(getTx() as any).mix, run: () => setMixOpen(true) },
    { id: 'save', cat: 'media', tint: '#7DD3FC', icon: 'save', label: 'Save media', on: false, run: saveMediaToDevice },
    { id: 'preview', cat: 'media', tint: '#FBBF24', icon: 'preview', label: 'Preview', on: false, run: () => setPreviewOn(true) },
    { id: 'entity', cat: 'sharing', tint: '#E8A13A', icon: 'entity', label: 'Tag', on: stickerCounts.entity > 0, run: () => setEntityOpen(true) },
    { id: 'gif', cat: 'fun', tint: '#C4B5FD', icon: 'gif', label: 'GIF', on: stickerCounts.gif > 0, run: () => setGifOpen(true) },
    { id: 'photo', cat: 'fun', tint: '#5EEAD4', icon: 'photo', label: 'Photo', on: stickerCounts.photo > 0, run: addPhotoSticker },

    { id: 'time', cat: 'fun', tint: '#93C5FD', icon: 'time', label: 'Time', on: stickerCounts.time > 0, run: () => addSimpleSticker({ kind: 'time', infoStyle: 0 }) },
    { id: 'date', cat: 'fun', tint: '#FCA5A5', icon: 'date', label: 'Date', on: stickerCounts.date > 0, run: () => addSimpleSticker({ kind: 'date', infoStyle: 0 }) },
    { id: 'weather', cat: 'fun', tint: '#6EE7B7', icon: 'weather', label: 'Weather', on: stickerCounts.weather > 0, run: addWeatherSticker },];

  return (
    <TouchableOpacity style={st.root} activeOpacity={1} onPress={() => Keyboard.dismiss()}>
      <StatusBar barStyle="light-content" />

      <Animated.View style={[st.canvasFrame, { opacity: mediaOpacity, transform: [{ scale: mediaScale }] }]}>
        {isTextStory ? (
          <View style={st.canvasInner} onLayout={e => setPreviewSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
            {(() => { const sharedPhoto = active?.stickers?.find(s => s.kind === 'post' && s.postMediaType !== 'video' && s.postMediaUrl)?.postMediaUrl; return sharedPhoto ? <View style={StyleSheet.absoluteFill} pointerEvents="none"><Image source={{ uri: sharedPhoto }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={32} /><View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,.48)' }]} /></View> : renderTextBg(active?.textBackground || null); })()}
            {active?.stickers && active.stickers.length > 0 && active.uploadState === 'idle' && (
              <ComposerStickerOverlay stickers={active.stickers} containerW={previewSize.w} containerH={previewSize.h} onDragEnd={handleDragEnd} onTapSticker={handleTapSticker} onScaleEnd={handleScaleEnd} onRotateEnd={handleRotateEnd} onDeleteDrop={handleDeleteDrop} player={vidPlayer} timingPreview={timingOpen || previewOn} />
            )}
            {hasPoll && active?.uploadState === 'idle' && (<PollDragWrap containerW={previewSize.w} containerH={previewSize.h} nx={active.pollData!.nx ?? 0.5} ny={active.pollData!.ny ?? 0.4} scale={active.pollData!.scale ?? 1} onChange={(nx, ny, scale) => updateActive({ pollData: { ...active.pollData!, nx, ny, scale } })} onTap={openPollEditor}><PollCard poll={{ poll_id: 'preview', question: active.pollData!.question, options: active.pollData!.options.map((label, i) => ({ id: String(i), label, vote_count: 0 })), total_votes: 0, my_vote: null }} isOwn={true} onVote={() => {}} onOpenVoters={() => {}} /></PollDragWrap>)}
          </View>
        ) : (
          <MediaCanvas
            localUri={arrangement.primaryCamera === 'rear' ? (active?.localUri || null) : (active?.dualFrontUri || null)}
            mediaType={active?.mediaType === 'video' ? 'video' : 'image'} uploadState={active?.uploadState || 'idle'} errorMsg={active?.errorMsg}
            onRetry={() => setDrafts(prev => prev.map((d, i) => i === activeIndex ? { ...d, uploadState: 'idle', errorMsg: null } : d))}
            onLayout={e => setPreviewSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
            scaleAnim={canvasScaleRef} opacityAnim={canvasOpacityRef}
            imageW={active?.imageW} imageH={active?.imageH} mediaFit={active?.mediaFit || 'cover'}
            mediaTransform={active?.mediaTransform || { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover' }}
            bg={((getTx() as any).bg ?? null)} videoPaused={shareOpen || textEditorOpen || musicOpen || publish.publishing} videoMuted={(((getTx() as any).mix?.orig ?? 100) <= 0)} videoVolume={Math.max(0, Math.min(1, ((getTx() as any).mix?.orig ?? 100) / 100))} videoSpeed={Number((getTx() as any).speed) || 1} trimStart={(getTx() as any).trimStart ?? null} trimEnd={(getTx() as any).trimEnd ?? null} onVideoPlayer={setVidPlayer}
            onTransformChange={handleTransformChange} onFitToggle={handleFitToggle}
            bottomInset={Math.max(48, insets.bottom + 14) + (isBusiness ? 150 : 106) + (active?.mediaType === 'video' ? 66 : 0)}
            interactive={arrangement.canvasInteractive && active?.uploadState === 'idle'}
          >
            <FilterLayer filterId={compareOriginal ? null : active?.filterId || null} amt={(getTx() as any).filterAmt} />
            <AdjustLayer adjust={compareOriginal ? null : (getTx() as any).adjust || null} />
            <DrawingLayer strokes={drawStrokes.length ? drawStrokes : null} width={previewSize.w} height={previewSize.h} />
            {!arrangement.arrangementOpen && active?.stickers && active.stickers.length > 0 && active.uploadState === 'idle' && (
              <ComposerStickerOverlay stickers={active.stickers} containerW={previewSize.w} containerH={previewSize.h} onDragEnd={handleDragEnd} onTapSticker={handleTapSticker} onScaleEnd={handleScaleEnd} onRotateEnd={handleRotateEnd} onDeleteDrop={handleDeleteDrop} player={vidPlayer} timingPreview={timingOpen || previewOn} />
            )}
            {hasPoll && active?.uploadState === 'idle' && (<PollDragWrap containerW={previewSize.w} containerH={previewSize.h} nx={active.pollData!.nx ?? 0.5} ny={active.pollData!.ny ?? 0.4} scale={active.pollData!.scale ?? 1} onChange={(nx, ny, scale) => updateActive({ pollData: { ...active.pollData!, nx, ny, scale } })} onTap={openPollEditor}><PollCard poll={{ poll_id: 'preview', question: active.pollData!.question, options: active.pollData!.options.map((label, i) => ({ id: String(i), label, vote_count: 0 })), total_votes: 0, my_vote: null }} isOwn={true} onVote={() => {}} onOpenVoters={() => {}} /></PollDragWrap>)}
          </MediaCanvas>
        )}

        {/* Studio rail: primary tools on the canvas, the rest behind the chevron */}
        {!drawMode && !previewOn && !timingOpen && !adjustOpen && active?.uploadState === 'idle' && (
          <StudioRail top={insets.top + 8} maxHeight={previewSize.h - (insets.top + 64) - (Math.max(48, insets.bottom + 14) + (isBusiness ? 150 : 106) + (active?.mediaType === 'video' ? 92 : 0) + 10)} items={([
            { id: 'rtext', label: 'Text', feather: 'type', primary: true, run: () => openTextEditor() },
            { id: 'rsticker', label: 'Sticker', feather: 'smile', primary: true, on: (active?.stickers || []).length > 0, run: () => setOverflowOpen(true) },
            { id: 'rcrop', label: (active?.mediaFit || 'cover') === 'contain' ? 'Fill' : 'Fit', feather: 'crop', on: (active?.mediaFit || 'cover') === 'contain', run: () => handleFitToggle() },
            { id: 'rsound', label: 'Sound', feather: 'music', primary: true, on: !!active?.audio, run: () => openMusicSheet() },
            ...(active?.mediaType === 'video' ? [{ id: 'rtiming', label: 'Timing & layers', icon: 'trim', on: false, run: () => setTimingOpen(true) } as RailItem, { id: 'rtrim', label: 'Split video', icon: 'trim', on: false, run: () => setTrimOpen(true) } as RailItem] : []),
            ...(active?.mediaType === 'video' ? [{ id: 'rmute', label: (((getTx() as any).mix?.orig ?? 100) <= 0) ? 'Unmute' : 'Mute', feather: (((getTx() as any).mix?.orig ?? 100) <= 0) ? 'volume-x' : 'volume-2', primary: true, on: (((getTx() as any).mix?.orig ?? 100) <= 0), run: () => { const mix = (getTx() as any).mix || {}; const wasMuted = (mix.orig ?? 100) <= 0; setTx({ mix: { ...mix, orig: wasMuted ? 100 : 0 } } as any); } } as RailItem] : []),
            ...(active?.mediaType === 'video' ? [{ id: 'rspeed', label: ((getTx() as any).speed && (getTx() as any).speed !== 1) ? (getTx() as any).speed + 'x' : 'Speed', feather: 'fast-forward', primary: true, on: !!((getTx() as any).speed && (getTx() as any).speed !== 1), run: () => { const cur = (getTx() as any).speed || 1; const opts = [0.5, 1, 1.5, 2, 3]; const i = opts.indexOf(cur); const next = opts[(i + 1) % opts.length]; setTx({ speed: next === 1 ? undefined : next } as any); } } as RailItem] : []),
            { id: 'rfilter', label: 'Filter', icon: 'filter', on: !!active?.filterId, run: () => openFilterSheet() },
            { id: 'radjust', label: 'Adjust', icon: 'adjust', on: !!(getTx() as any).adjust, run: () => setAdjustOpen(true) },
            { id: 'rdraw', label: 'Draw', icon: 'draw', on: drawStrokes.length > 0, run: () => setDrawMode(true) },
            { id: 'rbg', label: 'Backdrop', icon: 'bg', on: !!(getTx() as any).bg, run: () => { if ((active?.mediaFit || 'cover') !== 'contain') handleFitToggle(); setBgOpen(true); } },
            { id: 'rmix', label: 'Mix', icon: 'mix', on: !!(getTx() as any).mix, run: () => setMixOpen(true) },
            { id: 'rpreview', label: 'Preview', icon: 'preview', run: () => setPreviewOn(true) },
            { id: 'rsave', label: 'Save', icon: 'save', run: () => saveMediaToDevice() },
          ] as RailItem[])} />
        )}
        {/* Song chip: what plays, tap x to remove */}
        {!drawMode && !previewOn && !timingOpen && !adjustOpen && !!active?.audio && (
          <View style={{ position: 'absolute', left: 14, top: insets.top + 60, zIndex: 30, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(12,16,26,0.62)', borderRadius: 16, paddingLeft: 10, paddingRight: 6, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', maxWidth: 210 }}>
            <Feather name="music" size={13} color="#C9BFB0" />
            <Text style={{ color: '#FFFFFF', fontSize: 12.5, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{active.audio.title || (active.audio.kind === 'voiceover' ? 'Voiceover' : 'Sound')}</Text>
            <TouchableOpacity onPress={() => updateActive({ audio: null })} hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x" size={12} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}
        {/* Scrims */}
        <LinearGradient colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']} style={st.topScrim} pointerEvents="none" />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.4)']} style={st.bottomScrim} pointerEvents="none" />

        {/* Dual bubble */}
        {active?.dualFrontUri && (
          <TapGestureHandler ref={bubble.tapRef} onHandlerStateChange={bubble.onBubbleTap} waitFor={bubble.panRef}>
            <Animated.View style={[st.dualBubble, { transform: [{ translateX: Animated.subtract(bubble.animBubbleX, 75) }, { translateY: Animated.subtract(bubble.animBubbleY, 100) }, { scale: bubble.animBubbleScale }] }]} pointerEvents="box-none">
              <PanGestureHandler ref={bubble.panRef} onHandlerStateChange={bubble.onBubblePan} onGestureEvent={bubble.onBubblePan} enabled={arrangement.arrangementOpen || !publish.publishing}>
                <Animated.View style={{ width: 150, height: 200, borderRadius: 32, overflow: 'hidden' }}>
                  <Image source={{ uri: arrangement.primaryCamera === 'rear' ? (active.dualFrontUri || '') : (active.localUri || '') }} style={st.dualBubbleImg} resizeMode="cover" fadeDuration={0} />
                </Animated.View>
              </PanGestureHandler>
            </Animated.View>
          </TapGestureHandler>
        )}

        {/* Arrangement overlay */}
        {isDual && (
          <DualArrangementOverlay
            visible={arrangement.arrangementOpen} selectedPreset={arrangement.selectedPreset}
            primaryCamera={arrangement.primaryCamera} onPresetSelect={arrangement.handlePresetSelect}
            onSwap={arrangement.handleSwap} onDone={arrangement.closeArrangement}
            safeTop={insets.top} safeBottom={insets.bottom} reduceMotion={reduceMotion}
          />
        )}

        {/* Close button */}
        {!drawMode && !previewOn && !timingOpen && !adjustOpen && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close story editor" style={[st.closeBtn, { top: insets.top + 8 }]} onPress={() => navigation.goBack()} activeOpacity={0.7} disabled={publish.publishing} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <View style={st.closeBtnInner}><Feather name="x" size={18} color="#FFFFFF" /></View>
        </TouchableOpacity>
        )}

        {/* Top tool row — Instagram construction */}
        {!drawMode && !previewOn && !timingOpen && !adjustOpen && (
        <View style={[st.undoRedoWrap, { top: insets.top + 62 }]}>
          {(undoCount > 0 || redoCount > 0) && <>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Undo story edit" style={st.undoBtn} onPress={undo} disabled={undoCount === 0 || publish.publishing} activeOpacity={0.6}>
              <Feather name="corner-up-left" size={14} color={undoCount > 0 ? "#FFFFFF" : "rgba(255,255,255,0.35)"} />
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Redo story edit" style={st.undoBtn} onPress={redo} disabled={redoCount === 0 || publish.publishing} activeOpacity={0.6}>
              <Feather name="corner-up-right" size={14} color={redoCount > 0 ? "#FFFFFF" : "rgba(255,255,255,0.35)"} />
            </TouchableOpacity>
            <View style={st.toolRowGap} />
          </>}
        </View>
        )}

        <StoryAudienceSheet visible={audienceSheetOpen} onClose={() => setAudienceSheetOpen(false)} audience={audience}
          onChange={(a, people) => { setAudienceState(a as any); setDrafts(ds => ds.map(d => ({ ...d, audience: a, sharedWith: people || null } as any))); }} />
        {!drawMode && !previewOn && !timingOpen && !adjustOpen && !shareOpen ? <View style={[st.creationDock, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={st.dockTop}>
            <FlatList style={{ flex: 1 }} data={drafts} keyExtractor={d => d.id} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingRight: 8 }} renderItem={({ item, index }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit story clip ${index + 1}`} accessibilityState={{ selected: index === activeIndex }} style={[st.thumbWrap, index === activeIndex && st.thumbWrapActive]} onPress={() => { setActiveIndex(index); undoStackRef.current = []; redoStackRef.current = []; setUndoCount(0); setRedoCount(0); }} disabled={publish.publishing}>
              {item.mediaType === 'text' ? <View style={[st.thumb, { backgroundColor: (item.textBackground as any)?.color || '#0B1E3D', alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: '#FFFFFF', fontSize: 20 }}>Aa</Text></View> : item.localUri ? item.mediaType === 'video' ? <VideoThumb uri={item.localUri} posterUri={item.thumbnailUri || undefined} fill /> : <Image source={{ uri: item.localUri }} style={st.thumb} /> : <View style={st.thumb} />}
              {item.uploadState === 'done' ? <View style={st.thumbDone}><Feather name="check" size={16} color="#FFF" /></View> : null}
              {item.uploadState === 'error' ? <View style={st.thumbError}><Feather name="alert-circle" size={16} color="#FFF" /></View> : null}
              {!publish.publishing && item.uploadState !== 'done' && drafts.length > 1 ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove story clip ${index + 1}`} style={st.thumbRemove} onPress={() => removeDraft(index)} hitSlop={8}><Feather name="x" size={11} color="#FFF" /></TouchableOpacity> : null}
            </TouchableOpacity>} ListFooterComponent={drafts.length < STORY_CLIP_LIMIT ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add story clips" disabled={addingClips || publish.publishing} onPress={() => void addClips()} style={st.addClip}>{addingClips ? <ActivityIndicator color="#FAF6EE" /> : <Feather name="plus" size={25} color="#FAF6EE" />}</TouchableOpacity> : null} />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose story audience" onPress={() => setAudienceSheetOpen(true)} style={st.audiencePill} disabled={publish.publishing}><Feather name={audience === 'close_friends' ? 'star' : 'globe'} size={16} color="#FFFFFF" /><Text numberOfLines={1} style={st.audiencePillText}>{audience === 'close_friends' ? 'Close friends' : audience === 'followers' ? 'Followers' : audience === 'only_with' ? 'People' : 'Everyone'}</Text><Feather name="chevron-down" size={13} color="#FFFFFF" /></TouchableOpacity>
          </View>
          <View style={st.dockActions}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add story text" style={st.dockTool} onPress={() => openTextEditor()}><Feather name="type" size={24} color="#FFFFFF" /><Text style={st.dockToolText}>Text</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open story stickers" style={st.dockTool} onPress={() => setOverflowOpen(true)}><Feather name="smile" size={24} color="#FFFFFF" /><Text style={st.dockToolText}>Stickers</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose story music or original audio" style={st.dockTool} onPress={openMusicSheet}><Feather name="music" size={24} color="#FFFFFF" /><Text style={st.dockToolText}>Music</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit story media" style={st.dockTool} onPress={() => setAdjustOpen(true)}><Feather name="sliders" size={24} color="#FFFFFF" /><Text style={st.dockToolText}>Edit</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Review story before sharing" style={st.nextPill} onPress={() => { Keyboard.dismiss(); setShareOpen(true); }} disabled={publish.publishing}><Text style={st.nextText}>Next</Text><Feather name="arrow-right" size={18} color="#181B1E" /></TouchableOpacity>
          </View>
        </View> : null}
      </Animated.View>

      <StoryTimingPanel visible={timingOpen} uri={active?.mediaType === 'video' ? active.localUri : null} duration={active?.durationSec || 15} trimStart={(getTx() as any).trimStart || 0} trimEnd={(getTx() as any).trimEnd ?? Math.min(active?.durationSec || 15, 60)} player={vidPlayer} width={previewSize.w} topInset={insets.top} bottomInset={insets.bottom} stickers={active?.stickers || []} audioTitle={active?.audio?.title} onClose={() => setTimingOpen(false)} onTrim={(start, end) => setTx({ trimStart: start, trimEnd: end } as any)} onDuration={duration => updateActive({ durationSec: duration })} onLayerChange={(id, start, end) => updateStickers((active?.stickers || []).map(s => s.id === id ? { ...s, startSec: start, endSec: end } : s))} />
      {shareOpen ? <View accessibilityViewIsModal style={[st.shareScreen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={st.shareHeader}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to story editing" style={st.shareBack} onPress={() => setShareOpen(false)} disabled={publish.publishing}><Feather name="chevron-left" size={25} color="#FFFFFF" /></TouchableOpacity><Text style={st.shareTitle}>Share story</Text><View style={{ width: 44 }} /></View>
        <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {active ? <StoryReviewPreview draft={active} width={previewSize.w} height={previewSize.h} textBackground={renderTextBg(active.textBackground || null)} strokes={drawStrokes} /> : null}
          <Text style={st.clipCount}>{drafts.length} {drafts.length === 1 ? 'story clip' : 'story clips'}</Text>
          <Text style={st.shareSection}>Who can see this?</Text>
          {([{ id: 'everyone', label: 'Everyone', icon: 'globe' }, { id: 'close_friends', label: 'Close friends', icon: 'users' }, { id: 'only_with', label: 'Choose people', icon: 'user' }] as const).map(option => <TouchableOpacity key={option.id} accessibilityRole="radio" accessibilityState={{ selected: audience === option.id }} onPress={() => { if (option.id === 'only_with') setAudienceSheetOpen(true); else { setAudienceState(option.id); setDrafts(current => current.map(d => ({ ...d, audience: option.id, sharedWith: null }))); } }} style={st.shareRow} disabled={publish.publishing}><Feather name={option.icon} size={22} color="#FFFFFF" /><Text style={st.shareRowText}>{option.label}</Text><View style={[st.shareRadio, audience === option.id && st.shareRadioOn]} /></TouchableOpacity>)}
          {audience === 'followers' || audience === 'except' ? <TouchableOpacity accessibilityRole="button" onPress={() => setAudienceSheetOpen(true)} style={st.shareRow}><Text style={st.shareRowText}>{audience === 'followers' ? 'Followers' : 'Everyone except selected people'}</Text><Feather name="check-circle" size={22} color="#F1DFC5" /></TouchableOpacity> : null}
          <TouchableOpacity accessibilityRole="button" onPress={() => setAudienceSheetOpen(true)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#C9C6C0', fontSize: 12 }}>More audience options</Text></TouchableOpacity>
          <View style={st.shareToggle}><Feather name="message-circle" size={21} color="#F8F4EC" /><Text style={st.shareRowText}>Allow replies</Text><Switch accessibilityLabel="Allow story replies" value={allowReplies} onValueChange={value => { setAllowReplies(value); setDrafts(current => current.map(d => ({ ...d, allowReplies: value }))); }} disabled={publish.publishing} trackColor={{ false: '#454B50', true: '#EBD5B6' }} thumbColor="#FFFFFF" /></View>
          {isBusiness ? <TouchableOpacity accessibilityRole="button" onPress={toggleReach} style={st.shareRow} disabled={publish.publishing}><Feather name="trending-up" size={22} color="#FFFFFF" /><Text style={st.shareRowText}>{reach === 'wider' ? 'Wider reach' : 'Followers'}</Text><Feather name="chevron-right" size={20} color="#E8D3B6" /></TouchableOpacity> : null}
          <Text style={st.shareSection}>Add a caption</Text>
          <TextInput accessibilityLabel="Story caption" value={active?.caption || ''} onChangeText={t => updateActive({ caption: t })} placeholder="A moment worth sharing…" placeholderTextColor="#93989E" style={st.shareCaption} maxLength={120} multiline editable={!publish.publishing} keyboardAppearance="dark" />
          <Text style={st.shareHint}>Your story will be available for 24 hours. You can keep it in a memory book after sharing.</Text>
        </ScrollView>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Publish story" onPress={publish.publishAll} disabled={!canPublish} style={[st.shareButton, !canPublish && { opacity: 0.45 }]}>{publish.publishing ? <ActivityIndicator color="#181B1E" /> : <Text style={st.nextText}>Share story</Text>}</TouchableOpacity>
      </View> : null}

      {/* ── MODALS (text editor, emoji, poll, link, location, mention, question, slider, quiz, overflow, preview) ── */}
      {/* Text Editor Modal — Instagram construction */}
      <Modal visible={textEditorOpen} transparent animationType="fade" onRequestClose={closeTextEditor}>
        <View style={[st.textEditorOverlay, { paddingBottom: Platform.OS === 'ios' ? keyboard.keyboardHeight : 0 }]}>
          {isTextStory && active?.textBackground && <View style={StyleSheet.absoluteFill} pointerEvents="none">{renderTextBg(active.textBackground)}<View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} /></View>}
          <StoryTextEditorToolbar
            compact topInset={insets.top} alignment={stickerTextAlign} background={stickerBgEnabled}
            onClose={closeTextEditor} onSave={saveSticker}
            onAlign={() => setStickerTextAlign(a => a === 'center' ? 'left' : a === 'left' ? 'right' : 'center')}
            onBackground={() => setStickerBgEnabled(b => !b)}
            onDecreaseSize={() => setStickerFontSize(p => Math.max(12, (p || BASE_FONT_SIZES[stickerStyle] || 28) - 2))}
            onIncreaseSize={() => setStickerFontSize(p => Math.min(72, (p || BASE_FONT_SIZES[stickerStyle] || 28) + 2))}
            onDuplicate={editingStickerId ? () => duplicateSticker(editingStickerId) : undefined}
            onDelete={editingStickerId ? deleteEditingSticker : undefined}
          />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="always" bounces={false}>
          <View style={st.editorCenter}>
            {(() => { const p = composedTextStyle(stickerStyle, stickerColor, stickerBgEnabled, stickerFontSize > 0 ? stickerFontSize : undefined); return (
              <View style={[p.wrapperStyle, stickerOpacity < 1 && { opacity: stickerOpacity }]}>
                <TextInput ref={stickerInputRef} value={stickerText} onChangeText={setStickerText} placeholder="Type here" placeholderTextColor="rgba(255,255,255,0.35)" style={[p.textStyle as any, { textAlign: stickerTextAlign, maxWidth: STICKER_TEXT_MAX_W, minWidth: 40, padding: 0 }]} maxLength={100} autoFocus multiline keyboardAppearance="dark" />
              </View>
            ); })()}
          </View>
          </ScrollView>
          <ScrollView style={[st.editorBottom, { flexGrow: 0, maxHeight: Math.max(100, (SCREEN_H - (Platform.OS === 'ios' ? keyboard.keyboardHeight : 0) - insets.top - 64) * .58) }]} keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
            <View style={st.textPanelTabs}>{(['font', 'color', 'style', 'animate'] as const).map(panel => <TouchableOpacity key={panel} accessibilityRole="tab" accessibilityState={{ selected: textPanel === panel }} onPress={() => setTextPanel(panel)} style={[st.textPanelTab, textPanel === panel && st.textPanelTabOn]}><Text style={[st.textPanelLabel, textPanel === panel && { color: '#181B1E' }]}>{panel[0].toUpperCase() + panel.slice(1)}</Text></TouchableOpacity>)}</View>
            {textPanel === 'font' ? <ScrollView ref={stylePickerRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.stylePickerScroll} keyboardShouldPersistTaps="always">
              {(['classic', 'luxury', 'bold', 'typewriter', ...[...STICKER_STYLES, ...EXTRA_TEXT_STYLES].filter((x, index, all) => !['classic', 'luxury', 'bold', 'typewriter'].includes(x) && all.indexOf(x) === index)] as any[]).map(ss => { const fp = composedTextStyle(ss, '#FFFFFF', false); return (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={ss === 'luxury' ? 'Editorial' : (STICKER_STYLE_LABELS as any)[ss] || (EXTRA_TEXT_LABELS as any)[ss] || ss} accessibilityState={{ selected: stickerStyle === ss }} key={ss} style={[st.fontPill, stickerStyle === ss && st.fontPillActive]} onPress={() => setStickerStyle(ss)}>
                  <Text style={[{ color: '#FFF', fontFamily: (fp.textStyle as any).fontFamily, fontWeight: (fp.textStyle as any).fontWeight, fontStyle: (fp.textStyle as any).fontStyle }, st.fontPillTxt, stickerStyle === ss && st.fontPillTxtActive]} numberOfLines={1}>{ss === 'luxury' ? 'Editorial' : (STICKER_STYLE_LABELS as any)[ss] || (EXTRA_TEXT_LABELS as any)[ss] || ss}</Text>
                </TouchableOpacity>
              ); })}
            </ScrollView> : null}
            {textPanel === 'font' ? <View style={st.fontSizeRow}><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Text alignment: ${stickerTextAlign}`} onPress={() => setStickerTextAlign(a => a === 'center' ? 'left' : a === 'left' ? 'right' : 'center')} style={st.textAlignButton}><Feather name={`align-${stickerTextAlign}`} size={21} color="#FFFFFF" /></TouchableOpacity><MiniSlider label="Text size" value={stickerFontSize || BASE_FONT_SIZES[stickerStyle] || 28} min={12} max={72} width={Math.max(120, previewSize.w - 140)} onChange={setStickerFontSize} /><Text style={st.textPanelLabel}>{stickerFontSize || BASE_FONT_SIZES[stickerStyle] || 28}</Text></View> : null}
            {textPanel === 'color' ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.colorRowScroll} keyboardShouldPersistTaps="always">
              {STICKER_COLORS.map(c => (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Text color ${c}`} accessibilityState={{ selected: stickerColor === c }} key={c} style={[st.colorSwatch, stickerColor === c && st.colorSwatchActive]} onPress={() => setStickerColor(c)}><View style={[st.colorSwatchInner, { backgroundColor: c }]} /></TouchableOpacity>
              ))}
              <View style={{ width: 10 }} />
              {[0.3, 0.5, 0.7, 1.0].map(v => (
                <TouchableOpacity key={v} style={[st.opacityDot, stickerOpacity === v && st.opacityDotActive]} onPress={() => setStickerOpacity(v)}><Text style={[st.opacityDotTxt, stickerOpacity === v && st.opacityDotTxtActive]}>{Math.round(v * 100)}%</Text></TouchableOpacity>
              ))}
            </ScrollView> : null}
            {textPanel === 'animate' ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.colorRowScroll} keyboardShouldPersistTaps="always">
              {TEXT_ANIMS.map(an => (
                <TouchableOpacity key={an} style={[st.opacityDot, stickerAnim === an && st.opacityDotActive]} onPress={() => setStickerAnim(an)}>
                  <Text style={[st.opacityDotTxt, stickerAnim === an && st.opacityDotTxtActive]}>{an === 'none' ? 'No anim' : an}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView> : null}
            {textPanel === 'style' ? <View style={st.textStyleRow}><TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: stickerBgEnabled }} onPress={() => setStickerBgEnabled(b => !b)} style={st.fontPill}><Text style={st.textPanelLabel}>{stickerBgEnabled ? 'Background on' : 'Background off'}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" onPress={() => setStickerTextAlign(a => a === 'center' ? 'left' : a === 'left' ? 'right' : 'center')} style={st.fontPill}><Text style={st.textPanelLabel}>Align {stickerTextAlign}</Text></TouchableOpacity></View> : null}
            {textPanel === 'animate' && active?.mediaType === 'video' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8 }}>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '700' }}>Timing</Text>
                {([['start', stickerStartSec, setStickerStartSec], ['end', stickerEndSec, setStickerEndSec]] as any[]).map(([lb, val, setV]: any) => (
                  <View key={lb} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5 }}>{lb}</Text>
                    <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} onPress={() => setV((v: number | null) => { const base = v == null ? (lb === 'start' ? 0 : Math.round(active?.durationSec || 15)) : v; return Math.max(0, base - 1); })}><Feather name="minus" size={13} color="#FFF" /></TouchableOpacity>
                    <Text style={{ color: '#FFF', fontSize: 12.5, fontVariant: ['tabular-nums'], minWidth: 30, textAlign: 'center' }}>{val == null ? '—' : val + 's'}</Text>
                    <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} onPress={() => setV((v: number | null) => { const dmax = Math.round(active?.durationSec || 15); const base = v == null ? (lb === 'start' ? 0 : dmax) : v; return Math.min(dmax, base + 1); })}><Feather name="plus" size={13} color="#FFF" /></TouchableOpacity>
                  </View>
                ))}
                {(stickerStartSec != null || stickerEndSec != null) && (
                  <TouchableOpacity onPress={() => { setStickerStartSec(null); setStickerEndSec(null); }}><Text style={{ color: '#C9BFB0', fontSize: 11.5, fontWeight: '700' }}>Always</Text></TouchableOpacity>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>


      {/* Emoji Modal */}
      <Modal visible={emojiTrayOpen} transparent animationType="slide" onRequestClose={closeEmojiTray}>
        <TouchableOpacity style={st.emojiOverlay} activeOpacity={1} onPress={closeEmojiTray}>
          <View style={[st.emojiTray, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetGrab} />
            <View style={st.emojiHeader}><Text style={st.emojiTitle}>{editingEmojiStickerId ? 'Change emoji' : 'Emoji'}</Text>
              {editingEmojiStickerId && <TouchableOpacity onPress={() => { duplicateSticker(editingEmojiStickerId); closeEmojiTray(); }} style={st.emojiDuplicateBtn}><Feather name="copy" size={14} color="#0B1E3D" /><Text style={st.emojiDuplicateTxt}>Duplicate</Text></TouchableOpacity>}
              {editingEmojiStickerId && <TouchableOpacity onPress={deleteEditingEmoji} style={st.emojiDeleteBtn}><Feather name="trash-2" size={14} color="#C62F1D" /><Text style={st.emojiDeleteTxt}>Remove</Text></TouchableOpacity>}
            </View>
            <View style={st.emojiGrid}>{EMOJI_LIST.map(e => <TouchableOpacity key={e} style={st.emojiCell} onPress={() => selectEmoji(e)} activeOpacity={0.7}><Text style={st.emojiCellTxt}>{e}</Text></TouchableOpacity>)}</View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Poll Modal */}
      <Modal visible={pollEditorOpen} transparent animationType="slide" onRequestClose={closePollEditor}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={closePollEditor}><View style={{ width: '100%', paddingBottom: Platform.OS === 'ios' ? keyboard.keyboardHeight : 0 }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetGrab} />
            <View style={st.sheetHeader}><TouchableOpacity onPress={closePollEditor} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>Poll</Text><TouchableOpacity onPress={savePoll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetDoneTxt}>Done</Text></TouchableOpacity></View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false} style={{ maxHeight: SCREEN_H * 0.5 }} contentContainerStyle={{ paddingBottom: space.md }}>
              <View style={st.sheetPreview}>
                <Text style={st.sheetPreviewCap}>Preview</Text>
                <View style={st.sheetCard}>
                  <Text style={{ textAlign: 'center', color: '#0B1E3D', fontSize: 15, fontWeight: '800', marginBottom: 10 }}>{pollQuestion.trim() || 'Ask a question'}</Text>
                  {pollOptions.map((o, i) => (
                    <View key={i} style={{ backgroundColor: '#F2F3F5', borderRadius: 10, paddingVertical: 9, alignItems: 'center', marginTop: i === 0 ? 0 : 6 }}><Text style={{ color: o.trim() ? '#0B1E3D' : 'rgba(11,30,61,0.35)', fontSize: 13.5, fontWeight: '700' }}>{o.trim() || `Option ${i + 1}`}</Text></View>
                  ))}
                </View>
              </View>
              <View style={st.sheetInputWrap}><TextInput value={pollQuestion} onChangeText={setPollQuestion} placeholder="Ask a question..." placeholderTextColor="rgba(11,30,61,0.35)" style={st.sheetInput} maxLength={120} autoFocus keyboardAppearance="light" returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} /></View>
              {pollOptions.map((o, i) => <View key={i} style={st.pollOptionRow}><TextInput value={o} onChangeText={t => updatePollOption(i, t)} placeholder={`Option ${i+1}`} placeholderTextColor="rgba(11,30,61,0.35)" style={st.pollOptionInput} maxLength={40} keyboardAppearance="light" />{pollOptions.length > 2 && <TouchableOpacity onPress={() => removePollOption(i)} style={st.pollRemoveBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}><Feather name="x" size={16} color="rgba(11,30,61,0.5)" /></TouchableOpacity>}</View>)}
              {pollOptions.length < 4 && <TouchableOpacity onPress={addPollOption} style={st.pollAddBtn}><Feather name="plus" size={14} color="#0B1E3D" /><Text style={st.pollAddTxt}>Add option</Text></TouchableOpacity>}
            </ScrollView>
          </View>
        </TouchableOpacity></View></TouchableOpacity>
      </Modal>

      {/* Sticker Tray - Instagram construction */}
      {soundPreview.error || previewAudio.error ? <TouchableOpacity accessibilityRole="button" onPress={() => { soundPreview.retry(); previewAudio.retry(); }} style={{ padding: 12 }}><Text style={{ color: '#FFB4B4' }}>{soundPreview.error || previewAudio.error}</Text></TouchableOpacity> : null}
      <MusicSheet userId={myId} visible={musicOpen} onClose={() => setMusicOpen(false)} current={active?.audio || null} onSelect={(a: StoryAudioDraft) => { updateActive({ audio: a }); setMusicOpen(false); }} onShareTrack={(track) => { addSimpleSticker({ kind: 'link', text: track.title + ' · ' + track.artist, url: track.url }); setMusicOpen(false); }} onRemove={() => { updateActive({ audio: null }); }} disabled={publish.publishing} />
      <FilterPickerSheet visible={filterOpen} onClose={() => setFilterOpen(false)} selected={active?.filterId || null} onSelect={(fid: string | null) => { updateActive({ filterId: fid }); }} previewUri={active?.localUri || null} />
      <AdjustPanel visible={adjustOpen} onClose={() => { setAdjustOpen(false); setCompareOriginal(false); }} onCompare={setCompareOriginal} onCrop={() => { setAdjustOpen(false); handleFitToggle(); }} onFilters={() => { setAdjustOpen(false); openFilterSheet(); }} onDraw={() => { setAdjustOpen(false); setDrawMode(true); }} onTiming={active?.mediaType === 'video' ? () => { setAdjustOpen(false); setTimingOpen(true); } : undefined} adjust={((getTx() as any).adjust || {}) as StoryAdjust} onChange={(a: StoryAdjust) => setTx({ adjust: a } as any)} filterOn={!!active?.filterId} filterAmt={typeof (getTx() as any).filterAmt === 'number' ? (getTx() as any).filterAmt : 100} onFilterAmt={(v: number) => setTx({ filterAmt: v } as any)} />
      <BackgroundSheet visible={bgOpen} onClose={() => setBgOpen(false)} bg={((getTx() as any).bg || null) as StoryBg | null} onChange={(b: StoryBg) => setTx({ bg: b } as any)} />
      <AudioMixSheet visible={mixOpen} onClose={() => setMixOpen(false)} isVideo={active?.mediaType === 'video'} hasMusic={!!active?.audio} mix={((getTx() as any).mix || {}) as StoryMix} onChange={(m: StoryMix) => setTx({ mix: m } as any)} />
      <EntitySheet visible={entityOpen} onClose={() => setEntityOpen(false)} onPick={handleEntityPick} />
      <GifPickerLite visible={gifOpen} onClose={() => setGifOpen(false)} onSelect={handleGifPick} />
      {trimOpen && active?.mediaType === 'video' && !!active?.localUri && (
        <VideoTrimmer uri={active.localUri} durationSec={active.durationSec || 15} start={typeof (getTx() as any).trimStart === 'number' ? (getTx() as any).trimStart : 0} end={typeof (getTx() as any).trimEnd === 'number' ? (getTx() as any).trimEnd : Math.min(active.durationSec || 15, STORY_MAX_SEC)} onChange={(ts: number, te: number) => setTx({ trimStart: Math.round(ts * 10) / 10, trimEnd: Math.round(te * 10) / 10 } as any)} onDone={() => setTrimOpen(false)} onSplit={handleSplit} />
      )}
      {drawMode && (
        <DrawSurface width={previewSize.w || 1} height={previewSize.h || 1} strokes={drawStrokes} onChange={setDrawStrokes} onDone={() => setDrawMode(false)} />
      )}
      {previewOn && (
        <PreviewChrome name={(profile as any)?.username ? '@' + (profile as any).username : ((profile as any)?.full_name || 'You')} avatarUrl={(profile as any)?.avatar_url || null} onClose={() => setPreviewOn(false)} />
      )}

      <StudioSheet visible={overflowOpen} onClose={() => setOverflowOpen(false)} tiles={studioTiles} bottomInset={insets.bottom} extra={(
        <>
                  {hasPoll && (
                    <TouchableOpacity style={st.trayRemove} activeOpacity={0.7} onPress={() => { setOverflowOpen(false); removePoll(); }}>
                      <Feather name="trash-2" size={15} color="#FF3B30" />
                      <Text style={st.trayRemoveTxt}>Remove poll</Text>
                    </TouchableOpacity>
                  )}

                  {isTextStory && (
                    <>
                      <Text style={st.traySection}>Background</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4, gap: 10, paddingVertical: 8 }}>
                        {TEXT_BG_OPTIONS.map(o => (
                          <TouchableOpacity key={o.id} style={[st.bgSwatch, active?.textBgId === o.id && st.bgSwatchActive]} onPress={() => updateActive({ textBgId: o.id, textBackground: o.bg })} activeOpacity={0.7} disabled={publish.publishing}>
                            {o.previewColors.length === 1
                              ? <View style={[st.bgSwatchInner, { backgroundColor: o.previewColors[0] }, o.id === 'white' && st.bgSwatchWhite]} />
                              : <LinearGradient colors={o.previewColors as [string, string, ...string[]]} style={st.bgSwatchInner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  )}
        
        </>
      )} />
      {/* Link Modal */}
      <Modal visible={linkModalOpen} transparent animationType="slide" onRequestClose={closeLinkModal}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={closeLinkModal}><View style={{ width: '100%', paddingBottom: Platform.OS === 'ios' ? keyboard.keyboardHeight : 0 }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetGrab} />
            <View style={st.sheetHeader}><TouchableOpacity onPress={closeLinkModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>Link</Text><TouchableOpacity onPress={addLinkSticker} disabled={!linkLabel.trim() || !linkUrl.trim() || !isValidUrl(linkUrl.trim())} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={[st.sheetDoneTxt, (!linkLabel.trim() || !linkUrl.trim() || !isValidUrl(linkUrl.trim())) && { opacity: 0.35 }]}>Add</Text></TouchableOpacity></View>
            <View style={st.sheetInputWrap}><TextInput value={linkLabel} onChangeText={setLinkLabel} placeholder="Label (e.g. My website)" placeholderTextColor="rgba(11,30,61,0.35)" style={st.sheetInput} maxLength={60} autoFocus keyboardAppearance="light" returnKeyType="next" onSubmitEditing={() => linkUrlRef.current?.focus()} blurOnSubmit={false} /></View>
            <View style={st.sheetInputWrap}><TextInput ref={linkUrlRef} value={linkUrl} onChangeText={setLinkUrl} placeholder="https://..." placeholderTextColor="rgba(11,30,61,0.35)" style={st.sheetInput} maxLength={500} autoCapitalize="none" autoCorrect={false} keyboardType="url" keyboardAppearance="light" returnKeyType="done" onSubmitEditing={addLinkSticker} /></View>
            {linkUrl.trim().length > 0 && !isValidUrl(linkUrl.trim()) ? <Text style={st.linkErrorTxt}>Enter a valid URL starting with http:// or https://</Text> : <Text style={st.sheetHint}>Viewers tap the link sticker to open it.</Text>}
          </View>
        </TouchableOpacity></View></TouchableOpacity>
      </Modal>

      {/* Location Modal */}
      <Modal visible={locationModalOpen} transparent animationType="slide" onRequestClose={closeLocationModal}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={closeLocationModal}><View style={{ width: '100%', paddingBottom: Platform.OS === 'ios' ? keyboard.keyboardHeight : 0 }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: SCREEN_H * 0.7 }]}>
            <View style={st.sheetGrab} />
            <View style={st.sheetHeader}><TouchableOpacity onPress={closeLocationModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>Location</Text><View style={{ width: 64 }} /></View>
            <View style={st.sheetInputWrap}><TextInput value={locationSearch} onChangeText={onLocationSearchChange} placeholder="Search a place..." placeholderTextColor="rgba(11,30,61,0.35)" style={st.sheetInput} autoFocus keyboardAppearance="light" returnKeyType="search" /></View>
            {locationLoading && <ActivityIndicator color="#0B1E3D" style={{ marginVertical: 12 }} />}
            {locationError && <Text style={st.locationErrorTxt}>Search failed. Try again.</Text>}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: keyboard.keyboardHeight > 0 ? 220 : 300 }}>
              {locationResults.map((item, idx) => { const { name, subtitle } = fmtLoc(item); return (
                <TouchableOpacity key={idx} style={st.locationRow} onPress={() => addLocationSticker(item)} activeOpacity={0.6}>
                  <View style={st.locationPin}><Feather name="map-pin" size={16} color="#0B1E3D" /></View>
                  <View style={{ flex: 1 }}><Text style={st.locationName} numberOfLines={1}>{name}</Text>{subtitle ? <Text style={st.locationSub} numberOfLines={1}>{subtitle}</Text> : null}</View>
                  <Feather name="chevron-right" size={16} color="rgba(11,30,61,0.3)" />
                </TouchableOpacity>
              ); })}
              {!locationLoading && locationSearch.trim().length < 2 && locationResults.length === 0 ? <Text style={[st.sheetHint, { textAlign: 'center', paddingVertical: 18 }]}>Search a city, place or business</Text> : null}
              {!locationLoading && !locationError && locationSearch.trim().length >= 2 && locationResults.length === 0 ? <Text style={[st.sheetHint, { textAlign: 'center', paddingVertical: 18 }]}>No places found</Text> : null}
            </ScrollView>
          </View>
        </TouchableOpacity></View></TouchableOpacity>
      </Modal>

      {/* Mention Modal */}
      <Modal visible={mentionModalOpen} transparent animationType="slide" onRequestClose={closeMentionModal}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={closeMentionModal}><View style={{ width: '100%', paddingBottom: Platform.OS === 'ios' ? keyboard.keyboardHeight : 0 }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: SCREEN_H * 0.7 }]}>
            <View style={st.sheetGrab} />
            <View style={st.sheetHeader}>
              <TouchableOpacity onPress={closeMentionModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity>
              <Text style={st.sheetTitle}>Mention people</Text>
              <TouchableOpacity onPress={confirmMentions} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ backgroundColor: mentionPicks.length > 0 ? '#0B1E3D' : 'rgba(11,30,61,0.12)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 }}>
                <Text style={{ color: mentionPicks.length > 0 ? '#FFFFFF' : 'rgba(11,30,61,0.55)', fontWeight: '800', fontSize: 14 }}>{mentionPicks.length > 0 ? `Done (${mentionPicks.length})` : 'Done'}</Text>
              </TouchableOpacity>
            </View>
            <View style={st.sheetInputWrap}><TextInput value={mentionSearch} onChangeText={onMentionSearchChange} placeholder="Search people..." placeholderTextColor="rgba(11,30,61,0.35)" style={st.sheetInput} autoFocus autoCapitalize="none" keyboardAppearance="light" returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} /></View>
            {mentionPicks.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingTop: 10, gap: 6 }}>
                {mentionPicks.map(u => (
                  <TouchableOpacity key={u.id} onPress={() => toggleMentionPick(u)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingLeft: 5, paddingRight: 10, borderRadius: 999, backgroundColor: '#F2F3F5' }}>
                    {u.avatar_url ? <Image source={{ uri: u.avatar_url }} style={{ width: 22, height: 22, borderRadius: 11 }} /> : <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#0B1E3D' }} />}
                    <Text style={{ marginLeft: 6, fontSize: 12.5, fontWeight: '800', color: '#0B1E3D' }}>@{u.username || u.full_name}</Text>
                    <Feather name="x" size={12} color="#0B1E3D" style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {mentionLoading && <ActivityIndicator color="#0B1E3D" style={{ marginVertical: 12 }} />}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: keyboard.keyboardHeight > 0 ? 150 : 220 }}>
              {mentionResults.map(u => { const picked = mentionPicks.some(p => p.id === u.id); return (
                <TouchableOpacity key={u.id} style={st.mentionRow} onPress={() => toggleMentionPick(u)} activeOpacity={0.6}>
                  {u.avatar_url ? <Image source={{ uri: u.avatar_url }} style={st.mentionAvatar} /> : <View style={[st.mentionAvatar, { backgroundColor: '#E9EBEF', alignItems: 'center', justifyContent: 'center' }]}><Feather name="user" size={14} color="#0B1E3D" /></View>}
                  <View style={{ flex: 1 }}><View style={{ flexDirection: 'row', alignItems: 'center' }}><TierName userId={u.id} text={u.full_name || u.username} baseStyle={[st.mentionName, { flexShrink: 1 }]} /><View style={{ marginLeft: 5 }}><VerifiedBadge userId={u.id} size={13} /></View></View>{u.username && <Text style={[st.mentionUsername, { color: 'rgba(11,30,61,0.55)' }]} numberOfLines={1}>@{u.username}</Text>}</View>
                  <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: picked ? '#0B1E3D' : 'rgba(11,30,61,0.3)', backgroundColor: picked ? '#0B1E3D' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{picked ? <Feather name="check" size={14} color="#FFFFFF" /> : null}</View>
                </TouchableOpacity>
              ); })}
              {!mentionLoading && mentionSearch.trim().length >= 2 && mentionResults.length === 0 ? <Text style={[st.sheetHint, { textAlign: 'center', paddingVertical: 14 }]}>No one found</Text> : null}
              {!mentionLoading && mentionSearch.trim().length < 2 && mentionResults.length === 0 ? <Text style={[st.sheetHint, { textAlign: 'center', paddingVertical: 14 }]}>Type a name or @username</Text> : null}
            </ScrollView>
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,30,61,0.10)', marginTop: 8, paddingTop: 12 }}>
              <View style={{ flexDirection: 'row', backgroundColor: '#F2F3F5', borderRadius: 12, padding: 3 }}>
                <TouchableOpacity onPress={() => setMentionHidden(false)} activeOpacity={0.8} style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: !mentionHidden ? '#0B1E3D' : 'transparent' }}><Text style={{ fontSize: 13, fontWeight: '800', color: !mentionHidden ? '#FFFFFF' : '#0B1E3D' }}>On the story</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setMentionHidden(true)} activeOpacity={0.8} style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: mentionHidden ? '#0B1E3D' : 'transparent' }}><Text style={{ fontSize: 13, fontWeight: '800', color: mentionHidden ? '#FFFFFF' : '#0B1E3D' }}>Hidden</Text></TouchableOpacity>
              </View>
              <Text style={[st.sheetHint, { marginTop: 8 }]}>{mentionHidden ? 'Nobody sees the mention on your story. The people you pick still get notified and can view it.' : 'An @name tag appears on your story. Viewers can tap it to open their profile.'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ color: '#0B1E3D', fontSize: 13.5, fontWeight: '700' }}>Let them add this to their story</Text>
                <Switch value={(active as any)?.allowMentionReshare !== false} onValueChange={(v: boolean) => updateActive({ allowMentionReshare: v } as any)} trackColor={{ false: 'rgba(11,30,61,0.18)', true: '#0B1E3D' }} thumbColor="#FFFFFF" />
              </View>
              {(((active as any)?.hiddenMentions || []) as { id: string; username: string }[]).length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingTop: 10, gap: 6 }}>
                  <Text style={{ color: 'rgba(11,30,61,0.55)', fontSize: 12, fontWeight: '700', marginRight: 2 }}>Hidden on this story:</Text>
                  {(((active as any)?.hiddenMentions || []) as { id: string; username: string }[]).map(h => (
                    <TouchableOpacity key={h.id} onPress={() => removeHiddenMention(h.id)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(124,92,255,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(124,92,255,0.5)' }}>
                      <Feather name="eye-off" size={11} color="#7C5CFF" />
                      <Text style={{ marginLeft: 5, fontSize: 12, fontWeight: '700', color: '#0B1E3D' }}>@{h.username}</Text>
                      <Feather name="x" size={12} color="rgba(11,30,61,0.5)" style={{ marginLeft: 6 }} />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        </TouchableOpacity></View></TouchableOpacity>
      </Modal>

      {/* Question Modal */}
      <Modal visible={questionModalOpen} transparent animationType="slide" onRequestClose={() => { setQuestionModalOpen(false); setEditingQuestionId(null); }}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={() => { setQuestionModalOpen(false); setEditingQuestionId(null); }}><View style={{ width: '100%', paddingBottom: Platform.OS === 'ios' ? keyboard.keyboardHeight : 0 }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetGrab} />
            <View style={st.sheetHeader}><TouchableOpacity onPress={() => { setQuestionModalOpen(false); setEditingQuestionId(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>{editingQuestionId ? 'Edit question' : 'Question'}</Text><TouchableOpacity onPress={saveQuestion} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetDoneTxt}>Done</Text></TouchableOpacity></View>
            <View style={st.sheetPreview}>
              <Text style={st.sheetPreviewCap}>Preview</Text>
              <View style={st.sheetCard}>
                <Text style={{ textAlign: 'center', color: '#0B1E3D', fontSize: 15, fontWeight: '800' }}>{questionPrompt.trim() || 'Ask me anything'}</Text>
                <View style={{ marginTop: 10, backgroundColor: '#F2F3F5', borderRadius: 10, paddingVertical: 9, alignItems: 'center' }}><Text style={{ color: 'rgba(11,30,61,0.4)', fontSize: 13, fontWeight: '600' }}>Type something...</Text></View>
              </View>
            </View>
            <View style={st.sheetInputWrap}><TextInput value={questionPrompt} onChangeText={setQuestionPrompt} placeholder="Ask me anything..." placeholderTextColor="rgba(11,30,61,0.35)" style={st.sheetInput} maxLength={120} autoFocus keyboardAppearance="light" returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} /></View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={st.sheetHint}>Viewers answer privately. You see the answers.</Text><Text style={st.charCount}>{questionPrompt.length}/120</Text></View>
          </View>
        </TouchableOpacity></View></TouchableOpacity>
      </Modal>

      {/* Countdown Modal */}
      <Modal visible={!!stickerForm} transparent animationType="slide" onRequestClose={() => setStickerForm(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setStickerForm(null)} />
          <View style={{ backgroundColor: '#15161A', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: Math.max(insets.bottom, 14) + 8 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center', marginBottom: 12 }}>{stickerForm?.kind === 'addyours' ? 'Add yours' : stickerForm?.kind === 'notify' ? 'Notify me' : stickerForm?.kind === 'magic' ? 'Magic ball' : 'Support'}</Text>
            {stickerForm?.kind === 'addyours' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 8 }}>
                {AY_TEMPLATES.map((tpl) => <TouchableOpacity key={tpl} onPress={() => setStickerForm(f => f ? { ...f, a: tpl } : f)} style={{ borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' }}>{tpl}</Text></TouchableOpacity>)}
              </ScrollView>
            ) : null}
            <TextInput value={stickerForm?.a || ''} onChangeText={(v) => setStickerForm(f => f ? { ...f, a: v } : f)} placeholder={stickerForm?.kind === 'addyours' ? 'Your prompt, e.g. A photo from this week' : stickerForm?.kind === 'notify' ? 'What is happening, e.g. Album drops' : stickerForm?.kind === 'magic' ? 'A yes-or-no question, e.g. Will we win on Saturday?' : 'The cause or business'} placeholderTextColor="rgba(255,255,255,0.4)" maxLength={80} autoFocus
              style={{ height: 46, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', color: '#FFFFFF', paddingHorizontal: 14, fontSize: 15 }} />
            {stickerForm?.kind === 'support' ? <TextInput value={stickerForm?.b || ''} onChangeText={(v) => setStickerForm(f => f ? { ...f, b: v } : f)} placeholder="Link, e.g. example.org/donate" placeholderTextColor="rgba(255,255,255,0.4)" autoCapitalize="none" keyboardType="url" style={{ height: 46, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', color: '#FFFFFF', paddingHorizontal: 14, fontSize: 15, marginTop: 8 }} /> : null}
            <TouchableOpacity onPress={saveStickerForm} activeOpacity={0.85} style={{ marginTop: 14, height: 48, borderRadius: 14, backgroundColor: '#C9BFB0', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#0B1E3D', fontSize: 15, fontWeight: '800' }}>Add to story</Text></TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={countdownModalOpen} transparent animationType="slide" onRequestClose={() => setCountdownModalOpen(false)}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={() => setCountdownModalOpen(false)}><View style={{ width: '100%', paddingBottom: Platform.OS === 'ios' ? keyboard.keyboardHeight : 0 }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetGrab} />
            <View style={st.sheetHeader}><TouchableOpacity onPress={() => setCountdownModalOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>Countdown</Text><TouchableOpacity onPress={addCountdownSticker} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetDoneTxt}>Done</Text></TouchableOpacity></View>
            <View style={st.sheetInputWrap}><TextInput value={cdTitle} onChangeText={setCdTitle} placeholder="What are you counting down to?" placeholderTextColor="rgba(11,30,61,0.35)" style={st.sheetInput} maxLength={60} keyboardAppearance="light" autoFocus returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} /></View>
            <View style={st.sheetPreview}>
              <Text style={st.sheetPreviewCap}>Ends</Text>
              <Text style={{ color: '#0B1E3D', fontSize: 20, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 }}>{cdTarget.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 }}>
                {([[-86400000, '-1 day'], [-3600000, '-1 hr'], [-900000, '-15 min'], [900000, '+15 min'], [3600000, '+1 hr'], [86400000, '+1 day']] as const).map(([ms, lb]) => (
                  <TouchableOpacity key={lb} onPress={() => cdShift(ms)} style={[st.chip, { paddingHorizontal: 9, paddingVertical: 6 }]} activeOpacity={0.8}><Text style={[st.chipTxt, { fontSize: 11.5 }]}>{lb}</Text></TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={[st.sheetPreviewCap, { textAlign: 'left', marginBottom: 8 }]}>Quick pick</Text>
            <View style={st.chipRow}>
              {([['1h', 'In 1 hour'], ['3h', 'In 3 hours'], ['tonight', 'Tonight 8 PM'], ['tomorrow', 'Tomorrow 9 AM'], ['3d', 'In 3 days'], ['1w', 'In 1 week']] as const).map(([k, lb]) => (
                <TouchableOpacity key={k} onPress={() => cdPreset(k)} style={st.chip} activeOpacity={0.8}><Text style={st.chipTxt}>{lb}</Text></TouchableOpacity>
              ))}
            </View>
            <Text style={[st.sheetHint, { marginTop: 12 }]}>Viewers can tap the sticker to get a reminder when it ends.</Text>
          </View>
        </TouchableOpacity></View></TouchableOpacity>
      </Modal>

      {/* Hashtag Modal */}
      <Modal visible={hashtagModalOpen} transparent animationType="slide" onRequestClose={closeHashtagModal}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={closeHashtagModal}><View style={{ width: '100%', paddingBottom: Platform.OS === 'ios' ? keyboard.keyboardHeight : 0 }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetGrab} />
            <View style={st.sheetHeader}><TouchableOpacity onPress={closeHashtagModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>Hashtag</Text><TouchableOpacity onPress={addHashtagSticker} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetDoneTxt}>Done</Text></TouchableOpacity></View>
            <View style={st.sheetPreview}>
              <Text style={st.sheetPreviewCap}>Preview</Text>
              <View style={{ alignItems: 'center' }}><StickerPill label={hashtagText.replace(/^#/, '') || 'hashtag'} kind="hashtag" variant={1} /></View>
            </View>
            <View style={st.sheetInputWrap}><TextInput value={hashtagText} onChangeText={t => setHashtagText(t.replace(/[^A-Za-z0-9_#]/g, ''))} placeholder="#harare" placeholderTextColor="rgba(11,30,61,0.35)" style={st.sheetInput} maxLength={31} autoFocus autoCapitalize="none" autoCorrect={false} keyboardAppearance="light" returnKeyType="done" onSubmitEditing={addHashtagSticker} /></View>
            <Text style={st.sheetHint}>Letters, numbers and underscores. Viewers tap it to see the tag.</Text>
          </View>
        </TouchableOpacity></View></TouchableOpacity>
      </Modal>
      {/* Slider Modal */}
      <Modal visible={sliderModalOpen} transparent animationType="slide" onRequestClose={() => { setSliderModalOpen(false); setEditingSliderId(null); }}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={() => { setSliderModalOpen(false); setEditingSliderId(null); }}><View style={{ width: '100%', paddingBottom: Platform.OS === 'ios' ? keyboard.keyboardHeight : 0 }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetGrab} />
            <View style={st.sheetHeader}><TouchableOpacity onPress={() => { setSliderModalOpen(false); setEditingSliderId(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>{editingSliderId ? 'Edit slider' : 'Emoji slider'}</Text><TouchableOpacity onPress={saveSlider} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetDoneTxt}>Done</Text></TouchableOpacity></View>
            <View style={st.sheetPreview}>
              <Text style={st.sheetPreviewCap}>Preview</Text>
              <View style={st.sheetCard}>
                <Text style={{ textAlign: 'center', color: '#0B1E3D', fontSize: 14.5, fontWeight: '800', marginBottom: 12 }}>{sliderLabel.trim() || 'How much do you love this?'}</Text>
                <View style={{ height: 10, borderRadius: 5, backgroundColor: '#F2F3F5', justifyContent: 'center' }}>
                  <View style={{ position: 'absolute', left: 0, width: '55%', height: 10, borderRadius: 5, backgroundColor: '#C9BFB0' }} />
                  <Text style={{ position: 'absolute', left: '55%', marginLeft: -16, fontSize: 26 }}>{sliderEmoji || '❤️'}</Text>
                </View>
              </View>
            </View>
            <View style={st.sheetInputWrap}><TextInput value={sliderLabel} onChangeText={setSliderLabel} placeholder="How much do you love...?" placeholderTextColor="rgba(11,30,61,0.35)" style={st.sheetInput} maxLength={80} autoFocus keyboardAppearance="light" returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} /></View>
            <View style={st.sliderEmojiRow}>
              <Text style={st.sliderEmojiLabel}>Emoji</Text>
              {['❤️', '😍', '🔥', '😂', '👍', '😮', '🥺', '🤩'].map(em => (
                <TouchableOpacity key={em} onPress={() => setSliderEmoji(em)} style={[st.sliderEmojiChip, sliderEmoji === em && st.sliderEmojiChipOn]} activeOpacity={0.7}><Text style={{ fontSize: 20 }}>{em}</Text></TouchableOpacity>
              ))}
              <TextInput value={['❤️', '😍', '🔥', '😂', '👍', '😮', '🥺', '🤩'].includes(sliderEmoji) ? '' : sliderEmoji} onChangeText={t => { const v = t.slice(-2); if (v.trim()) setSliderEmoji(v); }} placeholder="+" placeholderTextColor="rgba(11,30,61,0.35)" style={st.sliderEmojiInput} maxLength={4} keyboardAppearance="light" />
            </View>
          </View>
        </TouchableOpacity></View></TouchableOpacity>
      </Modal>

      {/* Quiz Modal */}
      <Modal visible={quizModalOpen} transparent animationType="slide" onRequestClose={() => { setQuizModalOpen(false); setEditingQuizId(null); }}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={() => { setQuizModalOpen(false); setEditingQuizId(null); }}><View style={{ width: '100%', paddingBottom: Platform.OS === 'ios' ? keyboard.keyboardHeight : 0 }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetGrab} />
            <View style={st.sheetHeader}><TouchableOpacity onPress={() => { setQuizModalOpen(false); setEditingQuizId(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>{editingQuizId ? 'Edit quiz' : 'Quiz'}</Text><TouchableOpacity onPress={saveQuiz} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.sheetDoneTxt}>Done</Text></TouchableOpacity></View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: SCREEN_H * 0.5 }} contentContainerStyle={{ paddingBottom: space.md }}>
              <View style={st.sheetInputWrap}><TextInput value={quizQuestion} onChangeText={setQuizQuestion} placeholder="Quiz question..." placeholderTextColor="rgba(11,30,61,0.35)" style={st.sheetInput} maxLength={120} autoFocus keyboardAppearance="light" returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} /></View>
              {quizOptions.map((o, i) => (
                <View key={o.id} style={st.quizOptionRow}>
                  <TouchableOpacity style={[st.quizCorrectBtn, o.isCorrect && st.quizCorrectBtnActive]} onPress={() => setQuizOptions(p => p.map((opt, idx) => ({ ...opt, isCorrect: idx === i })))} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}><Feather name="check" size={14} color={o.isCorrect ? '#FFFFFF' : 'rgba(11,30,61,0.35)'} /></TouchableOpacity>
                  <TextInput value={o.label} onChangeText={t => setQuizOptions(p => p.map((opt, idx) => idx === i ? { ...opt, label: t } : opt))} placeholder={`Option ${i + 1}`} placeholderTextColor="rgba(11,30,61,0.35)" style={st.quizOptionInput} maxLength={40} keyboardAppearance="light" />
                  {quizOptions.length > 2 && <TouchableOpacity onPress={() => removeQuizOption(i)} style={st.pollRemoveBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}><Feather name="x" size={16} color="rgba(11,30,61,0.5)" /></TouchableOpacity>}
                </View>
              ))}
              {quizOptions.length < 4 && <TouchableOpacity onPress={addQuizOption} style={st.pollAddBtn}><Feather name="plus" size={14} color="#0B1E3D" /><Text style={st.pollAddTxt}>Add option</Text></TouchableOpacity>}
              <Text style={st.quizHint}>Tap the circle to mark the correct answer</Text>
            </ScrollView>
          </View>
        </TouchableOpacity></View></TouchableOpacity>
      </Modal>

      {/* Enhancement Modal */}
    </TouchableOpacity>
  );
}

// ════════════════════════════════════════════════════════════
// STYLES (renamed from 's' to 'st' to avoid collision with function params)
// ════════════════════════════════════════════════════════════

const st = StyleSheet.create({
  creationDock: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 14, paddingHorizontal: 16, backgroundColor: 'rgba(17,21,24,0.94)', borderTopLeftRadius: 28, borderTopRightRadius: 28, zIndex: 35, borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  dockTop: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  audiencePill: { maxWidth: 145, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 24, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }, audiencePillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  dockActions: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14 }, dockTool: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 5 }, dockToolText: { color: '#FFFFFF', fontSize: 11 },
  nextPill: { minWidth: 98, minHeight: 50, paddingHorizontal: 19, borderRadius: 28, backgroundColor: '#FA927A', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, nextText: { fontSize: 16, fontWeight: '800', color: '#181B1E' },
  shareScreen: { ...StyleSheet.absoluteFillObject, zIndex: 80, backgroundColor: '#111518' }, shareHeader: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 }, shareBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, shareTitle: { flex: 1, color: '#FFFFFF', fontSize: 21, fontWeight: '700', textAlign: 'center' },
  sharePreview: { alignSelf: 'center', width: 132, height: 194, borderRadius: 17, overflow: 'hidden', backgroundColor: '#252A2E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }, clipCount: { color: '#C5C8CC', fontSize: 13, marginTop: 12, textAlign: 'center', marginBottom: 24 },
  shareSection: { color: '#FFFFFF', fontWeight: '700', fontSize: 16, marginTop: 18, marginBottom: 12 }, shareRow: { minHeight: 58, borderRadius: 17, backgroundColor: '#22272B', borderWidth: 1, borderColor: '#353B40', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }, shareRowText: { flex: 1, fontSize: 15, color: '#FFFFFF', fontWeight: '600' },
  shareToggle: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 58, marginTop: 6, marginBottom: 6 }, shareRadio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#646A6E' }, shareRadioOn: { borderWidth: 6, borderColor: '#F1DFC5', backgroundColor: '#293034' },
  shareCaption: { minHeight: 96, borderRadius: 18, backgroundColor: '#22272B', borderWidth: 1, borderColor: '#353B40', paddingHorizontal: 16, paddingVertical: 14, color: '#FFFFFF', fontSize: 15, textAlignVertical: 'top' }, shareHint: { color: '#A0A6AC', fontSize: 12, lineHeight: 18, marginTop: 16 }, shareButton: { minHeight: 54, marginHorizontal: 22, borderRadius: 29, backgroundColor: '#E8D3B6', alignItems: 'center', justifyContent: 'center' },

  root: { flex: 1, backgroundColor: '#111518' },
  safe: { flex: 1, backgroundColor: '#111518' },
  canvasFrame: { flex: 1, overflow: 'hidden', position: 'relative', backgroundColor: surface.immersive, ...SHADOW_CANVAS },
  canvasInner: { flex: 1, position: 'relative' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 120, zIndex: Z_SCRIM, pointerEvents: 'none' as const },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 140, zIndex: Z_SCRIM, pointerEvents: 'none' as const },
  dualBubble: { position: 'absolute', zIndex: Z_BUBBLE, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', ...SHADOW_BUBBLE },
  dualBubbleImg: { width: '100%', height: '100%' },
  closeBtn: { position: 'absolute', left: 12, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', zIndex: Z_CHROME },
  closeBtnInner: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  undoRedoWrap: { position: 'absolute', left: 14, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: Z_CHROME },
  undoBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  topToolBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  toolRowGap: { width: 6 },
  captionFloating: { position: 'absolute', left: 14, right: 116, zIndex: 50 },
  captionInput: { backgroundColor: 'rgba(0,0,0,0.78)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 11, color: '#FFFFFF', fontSize: 14.5, fontWeight: '500', borderWidth: 1, borderColor: 'rgba(255,255,255,0.30)', minHeight: 42 },
  postPillWrap: { position: 'absolute', right: 14, zIndex: Z_CHROME },
  postPillInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 20, minHeight: 42, borderRadius: 20, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  postPillTxt: { color: '#0A0A0A', fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2 },
  invokeBtn: { position: 'absolute', bottom: 80, right: 14, width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', zIndex: Z_CHROME, overflow: 'hidden' },
  invokeTouchable: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  bloomTool: { position: 'absolute', width: BLOOM_TOOL_SIZE, height: BLOOM_TOOL_SIZE, borderRadius: BLOOM_TOOL_SIZE / 2, alignItems: 'center', justifyContent: 'center', zIndex: Z_BLOOM },
  bloomToolTouchable: { width: BLOOM_TOOL_SIZE, height: BLOOM_TOOL_SIZE, borderRadius: BLOOM_TOOL_SIZE / 2, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  bloomToolLabel: { position: 'absolute', bottom: -16, fontSize: 11, color: '#FFF', textAlign: 'center', width: 60 },
  momentBanner: { position: 'absolute', left: 44, right: 44, flexDirection: 'row', alignItems: 'center', gap: 6, zIndex: Z_STICKERS },
  momentBannerTxt: { color: '#F59E0B', fontSize: typeSize.micro, fontWeight: fontWeight.medium, flex: 1 },
  pollBadge: { position: 'absolute', bottom: 100, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  pollBadgeTxt: { color: '#FFF', fontSize: typeSize.caption, fontWeight: fontWeight.medium, flex: 1 },
  emptyFallback: { flex: 1, backgroundColor: palette.warmWhite, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyFallbackTitle: { color: accent.warmMuted, fontSize: typeSize.body, fontWeight: fontWeight.semibold, marginTop: 16 },
  emptyFallbackSub: { color: '#7A716599', fontSize: typeSize.caption, marginTop: 6, textAlign: 'center' },
  emptyFallbackBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 24, backgroundColor: accent.warm, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  emptyFallbackBtnTxt: { color: '#FFF', fontSize: typeSize.caption, fontWeight: fontWeight.semibold },
  stripWrap: { paddingVertical: 8, backgroundColor: palette.warmWhite },
  thumbWrap: { width: 54, height: 64, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', position: 'relative' },
  thumbWrapActive: { borderColor: '#FA927A' },
  addClip: { width: 54, height: 64, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: '#86898A', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%', backgroundColor: surface.immersive },
  videoIndicator: { position: 'absolute', bottom: 2, left: 2, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: 2 },
  thumbDone: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(52,199,89,0.5)', alignItems: 'center', justifyContent: 'center' } as any,
  thumbError: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,59,48,0.5)', alignItems: 'center', justifyContent: 'center' } as any,
  thumbRemove: { position: 'absolute', top: -1, right: -1, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  textEditorOverlay: { flex: 1, backgroundColor: 'rgba(14,17,20,0.48)' },
  textEditorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  textEditorCancel: { color: textColor.secondary, fontSize: typeSize.body, fontWeight: fontWeight.medium },
  textEditorDone: { color: accent.warm, fontSize: typeSize.body, fontWeight: fontWeight.bold },
  editorActionBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: surface.secondary, alignItems: 'center', justifyContent: 'center' },
  editorActionBtnOn: { backgroundColor: '#FFFFFF' },
  editorCenter: { flexGrow: 1, minHeight: 80, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 46, paddingHorizontal: 24, paddingVertical: 12 },
  textPanelTabs: { flexDirection: 'row', backgroundColor: '#25292D', borderRadius: 22, marginHorizontal: 14, padding: 3, marginBottom: 10 }, textPanelTab: { flex: 1, minHeight: 40, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }, textPanelTabOn: { backgroundColor: '#E8D3B6' }, textPanelLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' }, textStyleRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  fontSizeRow: { flexDirection: 'row', alignItems: 'center', gap: 17, paddingHorizontal: 16, minHeight: 50 }, textAlignButton: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#2B2E30', alignItems: 'center', justifyContent: 'center' },
  editorBottom: { paddingTop: 14, paddingBottom: 10, backgroundColor: '#191C1F', borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  fontPill: { minHeight: 46, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.14)' },
  fontPillActive: { backgroundColor: '#25292D', borderWidth: 2, borderColor: '#F1DFC5' },
  fontPillTxt: { fontSize: 13 },
  fontPillTxtActive: { color: '#FFFFFF' },
  colorRowScroll: { paddingHorizontal: 12, gap: 8, alignItems: 'center', paddingVertical: 8 },
  textEditorLivePreview: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.md, paddingHorizontal: space.md, minHeight: 60 },
  textEditorInputWrap: { marginHorizontal: space.md, marginBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor.default },
  textEditorInput: { color: '#FFF', fontSize: typeSize.body, fontWeight: fontWeight.medium, paddingVertical: space.sm, padding: 0 },
  stylePickerScroll: { paddingHorizontal: space.sm, gap: 8, alignItems: 'center', paddingVertical: 6 },
  styleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: surface.secondary },
  styleBtnActive: { backgroundColor: accent.warm },
  styleBtnTxt: { color: textColor.secondary, fontSize: typeSize.micro, fontWeight: fontWeight.semibold },
  styleBtnTxtActive: { color: '#020408' },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  colorSwatchActive: { borderColor: accent.warm },
  colorSwatchInner: { flex: 1, borderRadius: 12 },
  advancedToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  advancedToggleTxt: { color: 'rgba(255,255,255,0.4)', fontSize: typeSize.micro, fontWeight: fontWeight.medium },
  extraControlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: space.md, paddingVertical: space.xs },
  extraBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: surface.secondary },
  extraBtnActive: { backgroundColor: accent.warm },
  extraBtnTxt: { color: '#FFF', fontSize: typeSize.micro, fontWeight: fontWeight.medium },
  extraBtnTxtActive: { color: '#020408' },
  fontSizeControl: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fontSizeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: surface.secondary, alignItems: 'center', justifyContent: 'center' },
  fontSizeBtnTxt: { color: '#FFF', fontSize: typeSize.micro, fontWeight: fontWeight.bold },
  fontSizeLbl: { color: 'rgba(255,255,255,0.5)', fontSize: typeSize.micro, fontWeight: fontWeight.medium, minWidth: 22, textAlign: 'center' },
  alignControl: { flexDirection: 'row', gap: 2 },
  alignBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: surface.secondary, alignItems: 'center', justifyContent: 'center' },
  alignBtnActive: { backgroundColor: accent.warm },
  opacityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: space.xs, paddingHorizontal: space.md },
  opacityLabel: { color: 'rgba(255,255,255,0.4)', fontSize: typeSize.micro, fontWeight: fontWeight.medium },
  opacityTrack: { flexDirection: 'row', gap: 6 },
  opacityDot: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: surface.secondary },
  opacityDotActive: { backgroundColor: accent.warm },
  opacityDotTxt: { color: 'rgba(255,255,255,0.5)', fontSize: typeSize.micro, fontWeight: fontWeight.medium },
  opacityDotTxtActive: { color: '#020408' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: space.sm, paddingVertical: 10 },
  deleteBtnTxt: { color: '#FF3B30', fontSize: typeSize.caption, fontWeight: fontWeight.semibold },
  emojiOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  emojiTray: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 16 },
  emojiHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 },
  emojiTitle: { color: '#0B1E3D', fontSize: 16, fontWeight: '800', letterSpacing: -0.3, flex: 1 },
  emojiDeleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(198,47,29,0.10)' },
  emojiDeleteTxt: { color: '#C62F1D', fontSize: typeSize.micro, fontWeight: fontWeight.semibold },
  emojiDuplicateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#F2F3F5' },
  emojiDuplicateTxt: { color: '#0B1E3D', fontSize: typeSize.micro, fontWeight: fontWeight.semibold },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  emojiCell: { width: (SCREEN_W - 32 - 24) / 8, height: 46, alignItems: 'center', justifyContent: 'center' },
  emojiCellTxt: { fontSize: 30 },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetModal: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 16 },
  sheetGrab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(11,30,61,0.14)', marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingTop: 2 },
  sheetCancelTxt: { color: 'rgba(11,30,61,0.6)', fontSize: 15, fontWeight: '600', minWidth: 64 },
  sheetTitle: { color: '#0B1E3D', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  sheetDoneTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', backgroundColor: '#0B1E3D', paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, overflow: 'hidden', minWidth: 64, textAlign: 'center' },
  sheetInputWrap: { marginBottom: 12 },
  sheetInput: { color: '#0B1E3D', fontSize: 15.5, fontWeight: '600', backgroundColor: '#F2F3F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  sheetPreview: { backgroundColor: '#FAFAF9', borderRadius: 18, paddingVertical: 16, paddingHorizontal: 14, marginBottom: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.08)' },
  sheetPreviewCap: { color: 'rgba(11,30,61,0.45)', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center', marginBottom: 10 },
  sheetCard: { alignSelf: 'center', width: '84%', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  sheetHint: { color: 'rgba(11,30,61,0.55)', fontSize: 12.5, lineHeight: 17, paddingHorizontal: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F2F3F5', borderWidth: 1, borderColor: 'transparent' },
  chipOn: { backgroundColor: '#0B1E3D', borderColor: '#0B1E3D' },
  chipTxt: { color: '#0B1E3D', fontSize: 13, fontWeight: '700' },
  chipTxtOn: { color: '#FFFFFF' },
  pollOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  pollOptionInput: { flex: 1, color: '#0B1E3D', fontSize: 14.5, fontWeight: '600', backgroundColor: '#F2F3F5', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11 },
  pollRemoveBtn: { padding: 4 },
  pollAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  pollAddTxt: { color: 'rgba(11,30,61,0.55)', fontSize: typeSize.caption, fontWeight: fontWeight.semibold },
  overflowSheet: { backgroundColor: 'rgba(13,20,38,0.97)', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingTop: 8, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  overflowHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'center', marginBottom: 12 },
  overflowRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  overflowLabel: { color: textColor.primary, fontSize: 15.5, fontWeight: '500', letterSpacing: -0.2 },
  overflowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: borderColor.soft, marginVertical: 4 },
  trayTitle: { color: '#FFF', fontSize: 17, fontWeight: '800', letterSpacing: -0.4, paddingHorizontal: 4, paddingBottom: 14 },
  trayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  trayTitle2: { color: '#FFF', fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  traySearchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)' },
  traySearchInput: { flex: 1, color: '#FFF', fontSize: 14, padding: 0 },
  trayCatRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  trayCatPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  trayCatPillOn: { backgroundColor: 'rgba(139,92,246,0.16)', borderColor: '#8B5CF6' },
  trayCatTxt: { color: 'rgba(255,255,255,0.65)', fontSize: 12.5, fontWeight: '700' },
  trayCatTxtOn: { color: '#C4B5FD' },
  trayTile2: { width: '25%', alignItems: 'center', paddingVertical: 11 },
  trayChip: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  trayTile: { width: '25%', alignItems: 'center', paddingVertical: 10 },
  trayIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  trayIconOn: { backgroundColor: '#FFFFFF' },
  trayLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 11.5, fontWeight: '600', letterSpacing: -0.1, marginTop: 7 },
  traySection: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700', letterSpacing: 1.1, paddingHorizontal: 4, paddingTop: 16, paddingBottom: 2, textTransform: 'uppercase' },
  trayRemove: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 4, paddingTop: 10 },
  trayRemoveTxt: { color: '#FF3B30', fontSize: 13.5, fontWeight: '600' },  overflowSectionLabel: { color: textColor.secondary, fontSize: typeSize.micro, fontWeight: fontWeight.semibold, paddingHorizontal: 4, paddingTop: 4 },
  bgSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  bgSwatchActive: { borderColor: accent.warm },
  bgSwatchInner: { flex: 1, borderRadius: 16 },
  bgSwatchWhite: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
  linkErrorTxt: { color: '#C62F1D', fontSize: typeSize.micro, fontWeight: fontWeight.medium, paddingHorizontal: 4, paddingTop: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.08)' },
  locationPin: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(201,191,176,0.28)', alignItems: 'center', justifyContent: 'center' },
  locationName: { color: '#0B1E3D', fontSize: 14.5, fontWeight: '700' },
  locationSub: { color: 'rgba(11,30,61,0.55)', fontSize: typeSize.micro, marginTop: 2 },
  locationErrorTxt: { color: '#C62F1D', fontSize: typeSize.micro, fontWeight: fontWeight.medium, textAlign: 'center', paddingVertical: 12 },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  mentionAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: surface.secondary },
  mentionName: { color: '#0B1E3D', fontSize: typeSize.caption, fontWeight: fontWeight.semibold },
  mentionUsername: { color: textColor.secondary, fontSize: typeSize.micro, marginTop: 1 },
  charCount: { color: 'rgba(11,30,61,0.45)', fontSize: typeSize.micro, textAlign: 'right', paddingHorizontal: 4, paddingTop: 4 },
  sliderEmojiRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, flexWrap: 'wrap' },
  sliderEmojiLabel: { color: 'rgba(11,30,61,0.55)', fontSize: 12.5, fontWeight: '700', marginRight: 4 },
  sliderEmojiInput: { color: '#0B1E3D', fontSize: 22, width: 46, height: 40, textAlign: 'center', backgroundColor: '#F2F3F5', borderRadius: 12, paddingVertical: 4 },
  sliderEmojiChip: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F3F5', borderWidth: 1.5, borderColor: 'transparent' },
  sliderEmojiChipOn: { borderColor: '#0B1E3D', backgroundColor: '#FFFFFF' },
  quizOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  quizCorrectBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(11,30,61,0.25)', alignItems: 'center', justifyContent: 'center' },
  quizCorrectBtnActive: { backgroundColor: '#2F9E63', borderColor: '#2F9E63' },
  quizOptionInput: { flex: 1, color: '#0B1E3D', fontSize: 14.5, fontWeight: '600', backgroundColor: '#F2F3F5', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11 },
  quizHint: { color: 'rgba(11,30,61,0.55)', fontSize: typeSize.micro, textAlign: 'center', paddingTop: 8 },
});
