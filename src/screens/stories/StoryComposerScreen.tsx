import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, TextInput, FlatList,
  ActivityIndicator, Alert, Platform, StatusBar, KeyboardAvoidingView,
  Dimensions, Modal, ScrollView, Animated, Keyboard, AccessibilityInfo, Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  storiesService, StoryTextSticker, StoryStickerStyle, MediaFit, MediaTransform,
  StoryCategory, StoryTextBackground,
} from '../../services/storiesService';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import { stickerTextStyle, STICKER_STYLES, STICKER_STYLE_LABELS, BASE_FONT_SIZES } from '../../utils/stickerStyles';
import StickerOverlay from '../../components/stories/StickerOverlay';
import DraggableSticker from '../../components/stories/DraggableSticker';
import type { SmartGuideEntry } from '../../components/stories/DraggableSticker';
import MediaCanvas from '../../components/stories/MediaCanvas';
import CategoryPicker from '../../components/stories/CategoryPicker';
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
import { useEnhancementController } from '../../controllers/stories/useEnhancementController';
import EnhancerModal from '../../components/stories/EnhancerModal';
import IdentityTrainingWizard from './IdentityTrainingWizard';

// ── Constants ──
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const MAX_STICKERS = 10;
const STICKER_TEXT_MAX_W = Math.round(SCREEN_W * 0.85);
const DELETE_ZONE_HEIGHT = 80;
const SAFE_TOP_PX = 70;
const SAFE_BOTTOM_PX = 20;

const STICKER_COLORS = ['#FFFFFF','#000000','#FF3B30','#FF9500','#FFCC00','#34C759','#007AFF','#AF52DE'];
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
  { id: 'slate', label: 'Slate', bg: { kind: 'solid', color: '#334155' }, previewColors: ['#334155'], isDark: true },
  { id: 'white', label: 'White', bg: { kind: 'solid', color: '#FFFFFF' }, previewColors: ['#FFFFFF'], isDark: false },
  { id: 'platinum', label: 'Platinum', bg: { kind: 'gradient', colors: ['#C9BFB0', '#A89F91'], direction: 'diagonal' }, previewColors: ['#C9BFB0', '#A89F91'], isDark: false },
  { id: 'dusk', label: 'Dusk', bg: { kind: 'gradient', colors: ['#1a1a2e', '#16213e'], direction: 'vertical' }, previewColors: ['#1a1a2e', '#16213e'], isDark: true },
  { id: 'sunrise', label: 'Sunrise', bg: { kind: 'gradient', colors: ['#ff9a9e', '#fecfef'], direction: 'diagonal' }, previewColors: ['#ff9a9e', '#fecfef'], isDark: false },
  { id: 'ocean', label: 'Ocean', bg: { kind: 'gradient', colors: ['#667eea', '#764ba2'], direction: 'diagonal' }, previewColors: ['#667eea', '#764ba2'], isDark: true },
];

function getDefaultStickerColor(bgId: string): string {
  const opt = TEXT_BG_OPTIONS.find(o => o.id === bgId);
  return opt?.isDark ? '#FFFFFF' : '#000000';
}

type PollData = { question: string; options: string[] };
type Draft = {
  id: string; localUri: string | null; thumbnailUri: string | null;
  mediaType: 'image' | 'video' | 'text'; caption: string; scope: 'institution' | 'global';
  uploadState: 'idle' | 'uploading' | 'done' | 'error'; errorMsg?: string | null;
  durationSec?: number | null; pollData?: PollData | null; stickers?: StoryTextSticker[];
  imageW?: number; imageH?: number; mediaFit: MediaFit; mediaTransform: MediaTransform;
  category: StoryCategory | null; textBgId: string; textBackground: StoryTextBackground | null;
  dualFrontUri?: string | null; dualLayout?: any | null;
};

function newDraftId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function newStickerId() { return `stk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

type SmartGuidesState = { x: SmartGuideEntry; y: SmartGuideEntry; stickerId: string | null };

// ── ComposerStickerOverlay (unchanged from original) ──
function ComposerStickerOverlay({
  stickers, containerW, containerH, onDragEnd, onTapSticker, onScaleEnd, onRotateEnd,
  onSnapChange, snapGuides, onDragStart, onDeleteZoneChange, onDeleteDrop, dragZone,
  onSmartGuideChange, smartGuides,
}: {
  stickers: StoryTextSticker[]; containerW: number; containerH: number;
  onDragEnd: (id: string, nx: number, ny: number) => void; onTapSticker: (id: string) => void;
  onScaleEnd: (id: string, s: number) => void; onRotateEnd: (id: string, r: number) => void;
  onSnapChange: (id: string, x: boolean, y: boolean) => void;
  snapGuides: { x: boolean; y: boolean; stickerId?: string | null };
  onDragStart: (id: string) => void; onDeleteZoneChange: (id: string, inZone: boolean) => void;
  onDeleteDrop: (id: string) => void; dragZone: { draggingId: string | null; inDeleteZone: boolean };
  onSmartGuideChange: (id: string, x: SmartGuideEntry, y: SmartGuideEntry) => void; smartGuides: SmartGuidesState;
}) {
  const deleteZoneNy = containerH > 0 ? 1 - DELETE_ZONE_HEIGHT / containerH : 0.88;
  const safeTopNy = containerH > 0 ? SAFE_TOP_PX / containerH : 0.1;
  const safeBottomNy = containerH > 0 ? 1 - SAFE_BOTTOM_PX / containerH : 0.97;
  const deleteZoneOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(deleteZoneOpacity, { toValue: dragZone.draggingId ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [dragZone.draggingId]);
  if (!stickers || stickers.length === 0 || containerW === 0 || containerH === 0) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {snapGuides.x && <View style={snapStyles.guideVertical} pointerEvents="none" />}
      {snapGuides.y && <View style={snapStyles.guideHorizontal} pointerEvents="none" />}
      {smartGuides.x !== null && <View style={[snapStyles.smartGuideVertical, { left: smartGuides.x.position * containerW }]} pointerEvents="none" />}
      {smartGuides.y !== null && <View style={[snapStyles.smartGuideHorizontal, { top: smartGuides.y.position * containerH }]} pointerEvents="none" />}
      <Animated.View style={[snapStyles.deleteZone, dragZone.inDeleteZone && snapStyles.deleteZoneActive, { opacity: deleteZoneOpacity }]} pointerEvents="none">
        <Feather name="trash-2" size={20} color={dragZone.inDeleteZone ? '#FF3B30' : 'rgba(255,255,255,0.7)'} />
        <Text style={[snapStyles.deleteZoneText, dragZone.inDeleteZone && snapStyles.deleteZoneTextActive]}>
          {dragZone.inDeleteZone ? 'Release to delete' : 'Drag here to delete'}
        </Text>
      </Animated.View>
      {stickers.map(st => (
        <DraggableSticker key={st.id} sticker={st} containerW={containerW} containerH={containerH}
          onDragEnd={onDragEnd} onTap={onTapSticker} onScaleEnd={onScaleEnd} onRotateEnd={onRotateEnd}
          onSnapChange={onSnapChange} onDragStart={onDragStart} onDeleteZoneChange={onDeleteZoneChange}
          onDeleteDrop={onDeleteDrop} deleteZoneNy={deleteZoneNy} safeTopNy={safeTopNy}
          safeBottomNy={safeBottomNy} otherStickers={stickers.filter(s => s.id !== st.id)}
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
  const campusMomentPromptId: string | null = route.params?.campusMomentPromptId ?? null;
  const campusMomentPromptText: string | null = route.params?.campusMomentPromptText ?? null;
  const isDual = mode === 'dual';
  const openArrangementOnMount = route.params?.openArrangement === true && isDual;

  // ── Core draft state (stays in composer, shared across controllers) ──
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = drafts[activeIndex];
  const mountedRef = useRef(true);

  const updateActive = useCallback((patch: Partial<Draft>) => {
    setDrafts(prev => prev.map((d, i) => (i === activeIndex ? { ...d, ...patch } : d)));
  }, [activeIndex]);

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
  const bloomTools = useMemo(() => getBloomTools(isDual ? 'dual' : (mode as any)), [isDual, mode]);

  // ── CONTROLLER: Bloom (no deps on other controllers) ──
  const enhanceRef = useRef<() => void>(() => {});
  const handleBloomToolAction = useCallback((toolId: string) => {
    if (toolId === 'text') openTextEditor();
    else if (toolId === 'sticker') openEmojiTray();
    else if (toolId === 'more') setOverflowOpen(true);
    else if (toolId === 'layout') arrangement.openArrangement();
    else if (toolId === 'enhance') enhanceRef.current();
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

  // ── CONTROLLER: Publish (depends on bloom.closeBloom, mediaOpacity/Scale) ──
  const publish = usePublishOrchestrator({
    drafts, setDrafts, myId, navigation,
    closeBloom: bloom.closeBloom,
    mediaOpacity, mediaScale,
    campusMomentPromptId,
  });

  // Sync publishing ref so bloom/bubble read current value
  useEffect(() => { publishingRef.current = publish.publishing; }, [publish.publishing]);

  // ── CONTROLLER: Enhancement (depends on active draft, updateActive, pushHistory, bloom.closeBloom) ──
  const enhancement = useEnhancementController({
    draftId: active?.id || '',
    localUri: active?.localUri || null,
    originalUri: (active as any)?.originalUri || null,
    mediaType: active?.mediaType || 'image',
    updateDraft: updateActive,
    pushHistory,
    closeBloom: bloom.closeBloom,
  });

  // Wire enhance ref so bloom tool tap opens the enhancer
  useEffect(() => { enhanceRef.current = enhancement.openEnhancer; }, [enhancement.openEnhancer]);

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
        scope: 'institution', uploadState: 'idle', durationSec: null, pollData: null, stickers: [],
        imageW: 0, imageH: 0, mediaFit: 'cover' as MediaFit,
        mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover' as MediaFit },
        category: null, textBgId: 'navy', textBackground: TEXT_BG_OPTIONS[0].bg,
      }]);
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
        id: newDraftId(), localUri: rearUri, thumbnailUri: null, mediaType: 'image', caption: '',
        scope: 'institution', uploadState: 'idle', durationSec: null, pollData: null, stickers: [],
        imageW: da.rearDimensions?.width || 0, imageH: da.rearDimensions?.height || 0,
        mediaFit: 'cover' as MediaFit,
        mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover' as MediaFit },
        category: null, textBgId: 'navy', textBackground: null,
        dualFrontUri: frontUri, dualLayout: layout,
      }]);
      if (rearUri) Image.getSize(rearUri, (w, h) => { setDrafts(prev => prev.map((dd, di) => di === 0 ? { ...dd, imageW: w, imageH: h } : dd)); }, () => {});
      return;
    }
    if (initialAssets.length > 0) {
      const newDrafts: Draft[] = initialAssets.map((asset, idx) => {
        const uri = asset.localUri || asset.uri;
        const isVideo = mode === 'video' || asset.type === 'video' || asset.mediaType === 'video' || (uri && uri.toLowerCase().endsWith('.mp4'));
        if (!isVideo && uri) {
          Image.getSize(uri, (w, h) => { setDrafts(prev => prev.map((dd, di) => di === idx ? { ...dd, imageW: w, imageH: h } : dd)); }, () => {});
        }
        return {
          id: newDraftId(), localUri: uri, thumbnailUri: null, mediaType: isVideo ? 'video' as const : 'image' as const,
          caption: '', scope: 'institution' as const, uploadState: 'idle' as const,
          durationSec: isVideo ? (asset.duration || asset.durationSec ? Math.round((asset.duration || asset.durationSec * 1000) / 1000) : null) : null,
          pollData: null, stickers: [], imageW: asset.width || 0, imageH: asset.height || 0,
          mediaFit: 'cover' as MediaFit,
          mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover' as MediaFit },
          category: null, textBgId: 'navy', textBackground: null,
        };
      });
      setDrafts(newDrafts);
    }
  }, []);

  // ══════════════════════════════════════════════════════════
  // STICKER + MODAL STATE (next extraction target, stays for now)
  // ══════════════════════════════════════════════════════════

  const [previewSize, setPreviewSize] = useState({ w: SCREEN_W, h: SCREEN_H });
  const [previewMode, setPreviewMode] = useState(false);
  const [previewModalSize, setPreviewModalSize] = useState({ w: SCREEN_W, h: SCREEN_H });
  const undoStackRef = useRef<StoryTextSticker[][]>([]);
  const redoStackRef = useRef<StoryTextSticker[][]>([]);
  const MAX_HISTORY = 30;
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [snapGuides, setSnapGuides] = useState<{ x: boolean; y: boolean; stickerId?: string | null }>({ x: false, y: false, stickerId: null });
  const [dragZone, setDragZone] = useState<{ draggingId: string | null; inDeleteZone: boolean }>({ draggingId: null, inDeleteZone: false });
  const [smartGuides, setSmartGuides] = useState<SmartGuidesState>({ x: null, y: null, stickerId: null });

  // Text editor
  const [textEditorOpen, setTextEditorOpen] = useState(false);
  const [editingStickerId, setEditingStickerId] = useState<string | null>(null);
  const [stickerText, setStickerText] = useState('');
  const [stickerStyle, setStickerStyle] = useState<StoryStickerStyle>('classic');
  const [stickerColor, setStickerColor] = useState('#FFFFFF');
  const [stickerBgEnabled, setStickerBgEnabled] = useState(false);
  const [stickerFontSize, setStickerFontSize] = useState(0);
  const [stickerOpacity, setStickerOpacity] = useState(1.0);
  const [stickerTextAlign, setStickerTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [textEditorAdvanced, setTextEditorAdvanced] = useState(false);
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

  // Question
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

  // Debounce cleanup
  useEffect(() => { return () => { if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current); if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current); }; }, []);

  // ── Undo/Redo ──
  const pushHistory = useCallback(() => { const cur = active?.stickers || []; undoStackRef.current.push(cur.map(s => ({ ...s }))); if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift(); redoStackRef.current = []; setUndoCount(undoStackRef.current.length); setRedoCount(0); }, [active]);
  const undo = useCallback(() => { if (undoStackRef.current.length === 0) return; redoStackRef.current.push((active?.stickers || []).map(s => ({ ...s }))); updateActive({ stickers: undoStackRef.current.pop()! }); setUndoCount(undoStackRef.current.length); setRedoCount(redoStackRef.current.length); }, [active, updateActive]);
  const redo = useCallback(() => { if (redoStackRef.current.length === 0) return; undoStackRef.current.push((active?.stickers || []).map(s => ({ ...s }))); updateActive({ stickers: redoStackRef.current.pop()! }); setUndoCount(undoStackRef.current.length); setRedoCount(redoStackRef.current.length); }, [active, updateActive]);
  const updateStickers = useCallback((ns: StoryTextSticker[]) => { pushHistory(); updateActive({ stickers: ns }); }, [pushHistory, updateActive]);

  // ── Draft management ──
  const removeDraft = useCallback((index: number) => { setDrafts(prev => { const next = prev.filter((_, i) => i !== index); if (next.length === 0) { setActiveIndex(0); return next; } if (activeIndex >= next.length) setActiveIndex(next.length - 1); else if (activeIndex > index) setActiveIndex(activeIndex - 1); return next; }); }, [activeIndex]);
  const handleFitToggle = useCallback(() => { if (!active) return; const nf: MediaFit = active.mediaFit === 'cover' ? 'contain' : 'cover'; updateActive({ mediaFit: nf, mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: nf } }); }, [active, updateActive]);
  const handleTransformChange = useCallback((t: MediaTransform) => { updateActive({ mediaTransform: t }); }, [updateActive]);
  const nextStickerNy = useCallback((base: number = 0.4) => { const c = active?.stickers?.length ?? 0; return c === 0 ? base : Math.min(0.76, base + c * 0.12); }, [active]);

  // ── Text editor ──
  const openTextEditor = useCallback((existingId?: string) => {
    if (existingId && active?.stickers) { const ex = active.stickers.find(s => s.id === existingId); if (ex) { setEditingStickerId(existingId); setStickerText(ex.text); setStickerStyle(ex.style); setStickerColor(ex.color); setStickerBgEnabled(!!ex.bgEnabled); setStickerFontSize(ex.fontSizeOverride ?? 0); setStickerOpacity(ex.opacity ?? 1.0); setStickerTextAlign(ex.textAlign ?? 'center'); setTextEditorOpen(true); setTextEditorAdvanced(false); const si = STICKER_STYLES.indexOf(ex.style); if (si > 0) setTimeout(() => stylePickerRef.current?.scrollTo({ x: si * 72, animated: false }), 100); setTimeout(() => stickerInputRef.current?.focus(), 200); return; } }
    if ((active?.stickers?.length ?? 0) >= MAX_STICKERS) { Alert.alert('Limit reached', `Maximum ${MAX_STICKERS} text overlays per story.`); return; }
    setEditingStickerId(null); setStickerText(''); setStickerStyle('classic'); setStickerColor(active?.mediaType === 'text' ? getDefaultStickerColor(active.textBgId) : '#FFFFFF'); setStickerBgEnabled(false); setStickerFontSize(0); setStickerOpacity(1.0); setStickerTextAlign('center'); setTextEditorOpen(true); setTextEditorAdvanced(false); setTimeout(() => stickerInputRef.current?.focus(), 200);
  }, [active]);
  const closeTextEditor = useCallback(() => { setTextEditorOpen(false); setStickerText(''); setEditingStickerId(null); setTextEditorAdvanced(false); }, []);
  const saveSticker = useCallback(() => {
    const tr = stickerText.trim(); if (!tr) { if (editingStickerId) updateStickers((active?.stickers || []).filter(s => s.id !== editingStickerId)); closeTextEditor(); return; }
    const extra = { bgEnabled: stickerBgEnabled, fontSizeOverride: stickerFontSize > 0 ? stickerFontSize : undefined, opacity: stickerOpacity < 1.0 ? stickerOpacity : undefined, textAlign: stickerTextAlign !== 'center' ? stickerTextAlign : undefined };
    if (editingStickerId) { updateStickers((active?.stickers || []).map(s => s.id === editingStickerId ? { ...s, text: tr, style: stickerStyle, color: stickerColor, ...extra } : s)); }
    else { updateStickers([...(active?.stickers || []), { id: newStickerId(), text: tr, style: stickerStyle, color: stickerColor, nx: 0.5, ny: nextStickerNy(0.4), scale: 1, rotation: 0, ...extra }]); }
    closeTextEditor();
  }, [stickerText, stickerStyle, stickerColor, stickerBgEnabled, stickerFontSize, stickerOpacity, stickerTextAlign, editingStickerId, active, updateStickers, closeTextEditor, nextStickerNy]);
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
  const handleTapSticker = useCallback((id: string) => { if (publish.publishing) return; const s = active?.stickers?.find(x => x.id === id); if (!s) return; if (s.kind === 'emoji') openEmojiTray(id); else if (s.kind === 'question') openQuestionModal(id); else if (s.kind === 'slider') openSliderModal(id); else if (s.kind === 'quiz') openQuizModal(id); else openTextEditor(id); }, [publish.publishing, active]);
  const handleDragEnd = useCallback((id: string, nx: number, ny: number) => { updateStickers((active?.stickers || []).map(s => s.id === id ? { ...s, nx, ny } : s)); setDragZone({ draggingId: null, inDeleteZone: false }); }, [active, updateStickers]);
  const handleScaleEnd = useCallback((id: string, ns: number) => { updateStickers((active?.stickers || []).map(s => s.id === id ? { ...s, scale: ns } : s)); }, [active, updateStickers]);
  const handleRotateEnd = useCallback((id: string, nr: number) => { updateStickers((active?.stickers || []).map(s => s.id === id ? { ...s, rotation: nr } : s)); }, [active, updateStickers]);
  const handleSnapChange = useCallback((id: string, x: boolean, y: boolean) => { setSnapGuides(p => (!x && !y) ? (p.stickerId === id ? { x: false, y: false, stickerId: null } : p) : { x, y, stickerId: id }); }, []);
  const handleSmartGuideChange = useCallback((id: string, x: SmartGuideEntry, y: SmartGuideEntry) => { setSmartGuides(p => (x === null && y === null) ? (p.stickerId === id ? { x: null, y: null, stickerId: null } : p) : { x, y, stickerId: id }); }, []);
  const handleDragStart = useCallback((id: string) => { setDragZone({ draggingId: id, inDeleteZone: false }); }, []);
  const handleDeleteZoneChange = useCallback((id: string, inZone: boolean) => { setDragZone(p => p.draggingId !== id ? p : { ...p, inDeleteZone: inZone }); }, []);
  const handleDeleteDrop = useCallback((id: string) => { updateStickers((active?.stickers || []).filter(s => s.id !== id)); setDragZone({ draggingId: null, inDeleteZone: false }); setSnapGuides({ x: false, y: false, stickerId: null }); setSmartGuides({ x: null, y: null, stickerId: null }); }, [active, updateStickers]);

  // ── Poll ──
  const openPollEditor = useCallback(() => { if (active?.pollData) { setPollQuestion(active.pollData.question); setPollOptions([...active.pollData.options]); } else { setPollQuestion(''); setPollOptions(['', '']); } setPollEditorOpen(true); }, [active]);
  const closePollEditor = useCallback(() => setPollEditorOpen(false), []);
  const addPollOption = useCallback(() => { if (pollOptions.length < 4) setPollOptions(p => [...p, '']); }, [pollOptions.length]);
  const removePollOption = useCallback((i: number) => { if (pollOptions.length <= 2) return; setPollOptions(p => p.filter((_, idx) => idx !== i)); }, [pollOptions.length]);
  const updatePollOption = useCallback((i: number, t: string) => { setPollOptions(p => p.map((o, idx) => idx === i ? t : o)); }, []);
  const savePoll = useCallback(() => { const q = pollQuestion.trim(); if (!q) { Alert.alert('Missing question', 'Enter a poll question.'); return; } if (q.length > 120) { Alert.alert('Question too long', 'Keep under 120 characters.'); return; } const opts = pollOptions.map(o => o.trim()).filter(o => o.length > 0); if (opts.length < 2) { Alert.alert('Not enough options', 'Add at least 2.'); return; } for (const o of opts) { if (o.length > 40) { Alert.alert('Option too long', 'Keep under 40 characters.'); return; } } const ls = new Set<string>(); for (const o of opts) { const l = o.toLowerCase(); if (ls.has(l)) { Alert.alert('Duplicate', `"${o}" appears twice.`); return; } ls.add(l); } updateActive({ pollData: { question: q, options: opts } }); setPollEditorOpen(false); }, [pollQuestion, pollOptions, updateActive]);
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
  const openMentionModal = useCallback(() => { setMentionSearch(''); setMentionResults([]); setMentionModalOpen(true); }, []);
  const closeMentionModal = useCallback(() => { setMentionModalOpen(false); setMentionSearch(''); setMentionResults([]); if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current); }, []);
  const searchUsers = useCallback(async (q: string) => { const c = q.trim().replace(/^@/, '').toLowerCase(); if (c.length < 2) { setMentionResults([]); setMentionLoading(false); return; } setMentionLoading(true); try { const { data } = await supabase.from('profiles').select('id, full_name, username, avatar_url').or(`username.ilike.%${c}%,full_name.ilike.%${c}%`).neq('id', myId || '').limit(10); setMentionResults(data || []); } catch { setMentionResults([]); } finally { setMentionLoading(false); } }, [myId]);
  const onMentionSearchChange = useCallback((t: string) => { setMentionSearch(t); if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current); mentionDebounceRef.current = setTimeout(() => searchUsers(t), 300); }, [searchUsers]);
  const addMentionSticker = useCallback((u: any) => { updateStickers([...(active?.stickers || []), { id: newStickerId(), text: `@${u.username || u.full_name}`, style: 'classic' as StoryStickerStyle, color: '#FFFFFF', nx: 0.5, ny: 0.55, scale: 1, rotation: 0, kind: 'mention', mentionUserId: u.id, mentionUsername: u.username || u.full_name }]); closeMentionModal(); }, [active, updateStickers, closeMentionModal]);

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

  // ── Derived state ──
  const canPublish = drafts.length > 0 && !publish.publishing;
  const hasPoll = !!active?.pollData;
  const isTextStory = active?.mediaType === 'text';
  const stickerCounts = useMemo(() => { const st = active?.stickers || []; return { text: st.filter(s => !s.kind || s.kind === 'text').length, emoji: st.filter(s => s.kind === 'emoji').length, link: st.filter(s => s.kind === 'link').length, location: st.filter(s => s.kind === 'location').length, mention: st.filter(s => s.kind === 'mention').length, question: st.filter(s => s.kind === 'question').length, slider: st.filter(s => s.kind === 'slider').length, quiz: st.filter(s => s.kind === 'quiz').length }; }, [active?.stickers]);

  // ── Empty state ──
  if (drafts.length === 0) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="dark-content" />
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

  const invokeRotate = bloom.invokeRotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════

  return (
    <TouchableOpacity style={st.root} activeOpacity={1} onPress={() => Keyboard.dismiss()}>
      <StatusBar barStyle="dark-content" />

      <Animated.View style={[st.canvasFrame, { opacity: mediaOpacity, transform: [{ scale: mediaScale }] }]}>
        {isTextStory ? (
          <View style={st.canvasInner} onLayout={e => setPreviewSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
            {renderTextBg(active?.textBackground || null)}
            {active?.stickers && active.stickers.length > 0 && active.uploadState === 'idle' && (
              <ComposerStickerOverlay stickers={active.stickers} containerW={previewSize.w} containerH={previewSize.h} onDragEnd={handleDragEnd} onTapSticker={handleTapSticker} onScaleEnd={handleScaleEnd} onRotateEnd={handleRotateEnd} onSnapChange={handleSnapChange} snapGuides={snapGuides} onDragStart={handleDragStart} onDeleteZoneChange={handleDeleteZoneChange} onDeleteDrop={handleDeleteDrop} dragZone={dragZone} onSmartGuideChange={handleSmartGuideChange} smartGuides={smartGuides} />
            )}
            {hasPoll && active?.uploadState === 'idle' && <View style={st.pollBadge}><Feather name="bar-chart-2" size={14} color="#FFF" /><Text style={st.pollBadgeTxt} numberOfLines={1}>{active.pollData!.question}</Text></View>}
          </View>
        ) : (
          <MediaCanvas
            localUri={arrangement.primaryCamera === 'rear' ? (active?.localUri || null) : (active?.dualFrontUri || null)}
            mediaType={active?.mediaType || 'image'} uploadState={active?.uploadState || 'idle'} errorMsg={active?.errorMsg}
            onRetry={() => setDrafts(prev => prev.map((d, i) => i === activeIndex ? { ...d, uploadState: 'idle', errorMsg: null } : d))}
            onLayout={e => setPreviewSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
            scaleAnim={canvasScaleRef} opacityAnim={canvasOpacityRef}
            imageW={active?.imageW} imageH={active?.imageH} mediaFit={active?.mediaFit || 'cover'}
            mediaTransform={active?.mediaTransform || { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover' }}
            onTransformChange={handleTransformChange} onFitToggle={handleFitToggle}
            interactive={arrangement.canvasInteractive && active?.uploadState === 'idle'}
          >
            {!arrangement.arrangementOpen && active?.stickers && active.stickers.length > 0 && active.uploadState === 'idle' && (
              <ComposerStickerOverlay stickers={active.stickers} containerW={previewSize.w} containerH={previewSize.h} onDragEnd={handleDragEnd} onTapSticker={handleTapSticker} onScaleEnd={handleScaleEnd} onRotateEnd={handleRotateEnd} onSnapChange={handleSnapChange} snapGuides={snapGuides} onDragStart={handleDragStart} onDeleteZoneChange={handleDeleteZoneChange} onDeleteDrop={handleDeleteDrop} dragZone={dragZone} onSmartGuideChange={handleSmartGuideChange} smartGuides={smartGuides} />
            )}
            {hasPoll && active?.uploadState === 'idle' && <View style={st.pollBadge}><Feather name="bar-chart-2" size={14} color="#FFF" /><Text style={st.pollBadgeTxt} numberOfLines={1}>{active.pollData!.question}</Text></View>}
          </MediaCanvas>
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
        <TouchableOpacity style={[st.closeBtn, { top: insets.top + 8 }]} onPress={() => navigation.goBack()} activeOpacity={0.7} disabled={publish.publishing} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <View style={st.closeBtnInner}><Feather name="x" size={18} color={textColor.primary} /></View>
        </TouchableOpacity>

        {/* Undo/Redo */}
        {(undoCount > 0 || redoCount > 0) && (
          <View style={[st.undoRedoWrap, { top: insets.top + 8 }]}>
            <TouchableOpacity style={st.undoBtn} onPress={undo} disabled={undoCount === 0 || publish.publishing} activeOpacity={0.6}>
              <Feather name="corner-up-left" size={14} color={undoCount > 0 ? textColor.muted : textColor.whisper} />
            </TouchableOpacity>
            <TouchableOpacity style={st.undoBtn} onPress={redo} disabled={redoCount === 0 || publish.publishing} activeOpacity={0.6}>
              <Feather name="corner-up-right" size={14} color={redoCount > 0 ? textColor.muted : textColor.whisper} />
            </TouchableOpacity>
          </View>
        )}

        {/* Post button */}
        <Animated.View style={[st.postPillWrap, { opacity: keyboard.controlsOpacityAnim, bottom: Math.max(14, insets.bottom + 14) }]}>
          <TouchableOpacity onPress={publish.publishAll} disabled={!canPublish} style={[st.postPillInner, !canPublish && { opacity: 0.4 }]} activeOpacity={0.85}>
            {publish.publishing ? <ActivityIndicator color="#FFF" size={14} /> : <><Text style={st.postPillTxt}>Post</Text><Feather name="arrow-up" size={13} color="#FFF" /></>}
          </TouchableOpacity>
        </Animated.View>

        {/* Bloom invoke */}
        <Animated.View style={[st.invokeBtn, { backgroundColor: bloom.bloomOpen ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.5)' }]}>
          <TouchableOpacity style={st.invokeTouchable} onPress={bloom.bloomOpen ? bloom.closeBloom : bloom.openBloom} activeOpacity={0.8} disabled={publish.publishing} accessibilityLabel={bloom.bloomOpen ? 'Close creative tools' : 'Add creative element'}>
            <Animated.View style={{ transform: [{ rotate: invokeRotate }] }}>
              <Feather name="plus" size={20} color={bloom.bloomOpen ? accent.warm : '#FFF'} />
            </Animated.View>
          </TouchableOpacity>
        </Animated.View>

        {/* Bloom tools */}
        {bloom.bloomOpen && bloomTools.map((tool: BloomToolDef, i: number) => {
          const rad = (tool.angle * Math.PI) / 180;
          const dx = Math.cos(rad) * BLOOM_RADIUS;
          const dy = Math.sin(rad) * BLOOM_RADIUS;
          const prog = bloom.bloomToolAnims[i].progress;
          const toolScale = prog.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
          return (
            <Animated.View key={tool.id} style={[st.bloomTool, { right: 14 + 24 - 20 - dx, bottom: 80 + (INVOKE_SIZE / 2) - (BLOOM_TOOL_SIZE / 2) - dy, opacity: prog, transform: [{ scale: toolScale }] }]}>
              <TouchableOpacity style={st.bloomToolTouchable} onPress={() => bloom.handleBloomToolTap(tool.id)} activeOpacity={0.7} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
                <Feather name={tool.icon} size={20} color="#FFF" />
              </TouchableOpacity>
              <Animated.Text style={[st.bloomToolLabel, { opacity: bloom.bloomLabelOpacity }]}>{tool.label}</Animated.Text>
            </Animated.View>
          );
        })}

        {/* Campus moment banner */}
        {campusMomentPromptText && (
          <View style={[st.momentBanner, { top: insets.top + 52 }]}>
            <Feather name="sun" size={11} color="#F59E0B" />
            <Text style={st.momentBannerTxt} numberOfLines={1}>{campusMomentPromptText}</Text>
          </View>
        )}
      </Animated.View>

      {/* Caption */}
      {active?.uploadState === 'idle' && !arrangement.arrangementOpen && (
        <Animated.View style={[st.captionFloating, { bottom: keyboard.captionBottomAnim }]}>
          <TextInput value={active?.caption || ''} onChangeText={t => updateActive({ caption: t })} placeholder="Add a caption..." placeholderTextColor={textColor.faint} style={st.captionInput} maxLength={200} editable={!publish.publishing} keyboardAppearance="dark" returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} blurOnSubmit />
        </Animated.View>
      )}

      {/* Draft strip */}
      {drafts.length > 1 && (
        <View style={st.stripWrap}>
          <FlatList data={drafts} keyExtractor={d => d.id} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }} renderItem={({ item, index }) => {
            const isAct = index === activeIndex;
            return (
              <TouchableOpacity style={[st.thumbWrap, isAct && st.thumbWrapActive]} activeOpacity={0.7} onPress={() => { setActiveIndex(index); undoStackRef.current = []; redoStackRef.current = []; setUndoCount(0); setRedoCount(0); }} disabled={publish.publishing}>
                {item.mediaType === 'text' ? <View style={[st.thumb, { backgroundColor: (item.textBackground as any)?.color || '#0B1E3D' }]} /> : item.localUri ? <Image source={{ uri: item.localUri }} style={st.thumb} /> : <View style={[st.thumb, { backgroundColor: surface.immersive }]} />}
                {item.mediaType === 'video' && <View style={st.videoIndicator}><Feather name="play" size={10} color="#FFF" /></View>}
                {item.uploadState === 'done' && <View style={st.thumbDone}><Feather name="check" size={14} color="#FFF" /></View>}
                {item.uploadState === 'error' && <View style={st.thumbError}><Feather name="alert-circle" size={14} color="#FFF" /></View>}
                {!publish.publishing && item.uploadState !== 'done' && drafts.length > 1 && <TouchableOpacity style={st.thumbRemove} onPress={() => removeDraft(index)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}><Feather name="x" size={11} color="#FFF" /></TouchableOpacity>}
              </TouchableOpacity>
            );
          }} />
        </View>
      )}

      {/* ── MODALS (text editor, emoji, poll, link, location, mention, question, slider, quiz, overflow, preview) ── */}
      {/* Text Editor Modal */}
      <Modal visible={textEditorOpen} transparent animationType="slide" onRequestClose={closeTextEditor}>
        <View style={st.textEditorOverlay}>
          {isTextStory && active?.textBackground && <View style={StyleSheet.absoluteFill}>{renderTextBg(active.textBackground)}<View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} /></View>}
          <View style={[st.textEditorHeader, { paddingTop: Math.max(insets.top, 12) }]}>
            <TouchableOpacity onPress={closeTextEditor}><Text style={st.textEditorCancel}>Cancel</Text></TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {editingStickerId && <TouchableOpacity onPress={() => duplicateSticker(editingStickerId)} style={st.editorActionBtn}><Feather name="copy" size={16} color="#FFF" /></TouchableOpacity>}
              {editingStickerId && <TouchableOpacity onPress={() => bringForward(editingStickerId)} style={st.editorActionBtn}><Feather name="arrow-up" size={16} color="#FFF" /></TouchableOpacity>}
              {editingStickerId && <TouchableOpacity onPress={() => sendBackward(editingStickerId)} style={st.editorActionBtn}><Feather name="arrow-down" size={16} color="#FFF" /></TouchableOpacity>}
              <TouchableOpacity onPress={saveSticker}><Text style={st.textEditorDone}>Done</Text></TouchableOpacity>
            </View>
          </View>
          <View style={st.textEditorLivePreview}>{(() => { const p = stickerTextStyle(stickerStyle, stickerColor, stickerBgEnabled, stickerFontSize > 0 ? stickerFontSize : undefined); return <View style={[p.wrapperStyle, stickerOpacity < 1 && { opacity: stickerOpacity }]}><Text style={[p.textStyle, { textAlign: stickerTextAlign, maxWidth: STICKER_TEXT_MAX_W }]}>{stickerText || 'Preview'}</Text></View>; })()}</View>
          <View style={st.textEditorInputWrap}><TextInput ref={stickerInputRef} value={stickerText} onChangeText={setStickerText} placeholder="Type here..." placeholderTextColor="rgba(255,255,255,0.3)" style={st.textEditorInput} maxLength={100} autoFocus keyboardAppearance="dark" /></View>
          <ScrollView ref={stylePickerRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.stylePickerScroll}>
            {STICKER_STYLES.map(ss => (<TouchableOpacity key={ss} style={[st.styleBtn, stickerStyle === ss && st.styleBtnActive]} onPress={() => setStickerStyle(ss)}><Text style={[st.styleBtnTxt, stickerStyle === ss && st.styleBtnTxtActive]}>{STICKER_STYLE_LABELS[ss]?.short || ss}</Text></TouchableOpacity>))}
            {STICKER_COLORS.map(c => (<TouchableOpacity key={c} style={[st.colorSwatch, stickerColor === c && st.colorSwatchActive]} onPress={() => setStickerColor(c)}><View style={[st.colorSwatchInner, { backgroundColor: c }]} /></TouchableOpacity>))}
          </ScrollView>
          <TouchableOpacity style={st.advancedToggle} onPress={() => setTextEditorAdvanced(p => !p)}><Feather name="sliders" size={14} color={textEditorAdvanced ? accent.warm : 'rgba(255,255,255,0.4)'} /><Text style={[st.advancedToggleTxt, textEditorAdvanced && { color: accent.warm }]}>{textEditorAdvanced ? 'Less' : 'More'}</Text></TouchableOpacity>
          {textEditorAdvanced && <>
            <View style={st.extraControlsRow}>
              <TouchableOpacity style={[st.extraBtn, stickerBgEnabled && st.extraBtnActive]} onPress={() => setStickerBgEnabled(b => !b)}><Feather name="square" size={14} color={stickerBgEnabled ? '#020408' : '#FFF'} /><Text style={[st.extraBtnTxt, stickerBgEnabled && st.extraBtnTxtActive]}>BG</Text></TouchableOpacity>
              <View style={st.fontSizeControl}><TouchableOpacity onPress={() => setStickerFontSize(p => Math.max(0, (p || BASE_FONT_SIZES[stickerStyle] || 28) - 2))} style={st.fontSizeBtn}><Text style={st.fontSizeBtnTxt}>A-</Text></TouchableOpacity><Text style={st.fontSizeLbl}>{stickerFontSize > 0 ? stickerFontSize : (BASE_FONT_SIZES[stickerStyle] || 28)}</Text><TouchableOpacity onPress={() => setStickerFontSize(p => Math.min(72, (p || BASE_FONT_SIZES[stickerStyle] || 28) + 2))} style={st.fontSizeBtn}><Text style={st.fontSizeBtnTxt}>A+</Text></TouchableOpacity></View>
              <View style={st.alignControl}>{(['left','center','right'] as const).map(a => <TouchableOpacity key={a} style={[st.alignBtn, stickerTextAlign === a && st.alignBtnActive]} onPress={() => setStickerTextAlign(a)}><Feather name={`align-${a}`} size={13} color={stickerTextAlign === a ? '#020408' : '#FFF'} /></TouchableOpacity>)}</View>
            </View>
            <View style={st.opacityRow}><Text style={st.opacityLabel}>Opacity</Text><View style={st.opacityTrack}>{[0.3,0.5,0.7,1.0].map(v => <TouchableOpacity key={v} style={[st.opacityDot, stickerOpacity === v && st.opacityDotActive]} onPress={() => setStickerOpacity(v)}><Text style={[st.opacityDotTxt, stickerOpacity === v && st.opacityDotTxtActive]}>{Math.round(v*100)}%</Text></TouchableOpacity>)}</View></View>
          </>}
          {editingStickerId && <TouchableOpacity style={st.deleteBtn} onPress={deleteEditingSticker}><Feather name="trash-2" size={16} color="#FF3B30" /><Text style={st.deleteBtnTxt}>Delete</Text></TouchableOpacity>}
        </View>
      </Modal>

      {/* Emoji Modal */}
      <Modal visible={emojiTrayOpen} transparent animationType="slide" onRequestClose={closeEmojiTray}>
        <TouchableOpacity style={st.emojiOverlay} activeOpacity={1} onPress={closeEmojiTray}>
          <View style={[st.emojiTray, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.emojiHeader}><Text style={st.emojiTitle}>{editingEmojiStickerId ? 'Change Emoji' : 'Add Emoji'}</Text>
              {editingEmojiStickerId && <TouchableOpacity onPress={deleteEditingEmoji} style={st.emojiDeleteBtn}><Feather name="trash-2" size={16} color="#FF3B30" /><Text style={st.emojiDeleteTxt}>Remove</Text></TouchableOpacity>}
              {editingEmojiStickerId && <TouchableOpacity onPress={() => { duplicateSticker(editingEmojiStickerId); closeEmojiTray(); }} style={st.emojiDuplicateBtn}><Feather name="copy" size={16} color="#FFF" /><Text style={st.emojiDuplicateTxt}>Duplicate</Text></TouchableOpacity>}
            </View>
            <View style={st.emojiGrid}>{EMOJI_LIST.map(e => <TouchableOpacity key={e} style={st.emojiCell} onPress={() => selectEmoji(e)} activeOpacity={0.7}><Text style={st.emojiCellTxt}>{e}</Text></TouchableOpacity>)}</View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Poll Modal */}
      <Modal visible={pollEditorOpen} transparent animationType="slide" onRequestClose={closePollEditor}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={closePollEditor}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetHeader}><TouchableOpacity onPress={closePollEditor}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>Create Poll</Text><TouchableOpacity onPress={savePoll}><Text style={st.sheetDoneTxt}>Done</Text></TouchableOpacity></View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false} style={{ maxHeight: SCREEN_H * 0.45 }} contentContainerStyle={{ paddingBottom: space.md }}>
              <View style={st.sheetInputWrap}><TextInput value={pollQuestion} onChangeText={setPollQuestion} placeholder="Ask a question..." placeholderTextColor="rgba(255,255,255,0.4)" style={st.sheetInput} maxLength={120} autoFocus keyboardAppearance="dark" /></View>
              {pollOptions.map((o, i) => <View key={i} style={st.pollOptionRow}><TextInput value={o} onChangeText={t => updatePollOption(i, t)} placeholder={`Option ${i+1}`} placeholderTextColor="rgba(255,255,255,0.3)" style={st.pollOptionInput} maxLength={40} keyboardAppearance="dark" />{pollOptions.length > 2 && <TouchableOpacity onPress={() => removePollOption(i)} style={st.pollRemoveBtn}><Feather name="x" size={16} color="rgba(255,255,255,0.5)" /></TouchableOpacity>}</View>)}
              {pollOptions.length < 4 && <TouchableOpacity onPress={addPollOption} style={st.pollAddBtn}><Feather name="plus" size={14} color="rgba(255,255,255,0.6)" /><Text style={st.pollAddTxt}>Add option</Text></TouchableOpacity>}
            </ScrollView>
          </View>
        </TouchableOpacity></KeyboardAvoidingView></TouchableOpacity>
      </Modal>

      {/* Overflow Modal */}
      <Modal visible={overflowOpen} transparent animationType="slide" onRequestClose={() => setOverflowOpen(false)}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={() => setOverflowOpen(false)}>
          <View style={[st.overflowSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.overflowHandle} />
            <TouchableOpacity style={st.overflowRow} onPress={() => { setOverflowOpen(false); openPollEditor(); }} activeOpacity={0.6}><Feather name="bar-chart-2" size={18} color={hasPoll ? accent.warm : textColor.secondary} /><Text style={st.overflowLabel}>{hasPoll ? 'Edit Poll' : 'Poll'}</Text></TouchableOpacity>
            {hasPoll && <TouchableOpacity style={st.overflowRow} onPress={() => { setOverflowOpen(false); removePoll(); }} activeOpacity={0.6}><Feather name="trash-2" size={18} color="#FF3B30" /><Text style={[st.overflowLabel, { color: '#FF3B30' }]}>Remove Poll</Text></TouchableOpacity>}
            <TouchableOpacity style={st.overflowRow} onPress={() => { setOverflowOpen(false); openLinkModal(); }} activeOpacity={0.6}><Feather name="link" size={18} color={stickerCounts.link > 0 ? accent.warm : textColor.secondary} /><Text style={st.overflowLabel}>Link</Text></TouchableOpacity>
            <TouchableOpacity style={st.overflowRow} onPress={() => { setOverflowOpen(false); openLocationModal(); }} activeOpacity={0.6}><Feather name="map-pin" size={18} color={stickerCounts.location > 0 ? accent.warm : textColor.secondary} /><Text style={st.overflowLabel}>Location</Text></TouchableOpacity>
            <TouchableOpacity style={st.overflowRow} onPress={() => { setOverflowOpen(false); openMentionModal(); }} activeOpacity={0.6}><Feather name="at-sign" size={18} color={stickerCounts.mention > 0 ? accent.warm : textColor.secondary} /><Text style={st.overflowLabel}>Mention</Text></TouchableOpacity>
            <View style={st.overflowDivider} />
            <TouchableOpacity style={st.overflowRow} onPress={() => { setOverflowOpen(false); openQuestionModal(); }} activeOpacity={0.6}><Feather name="help-circle" size={18} color={stickerCounts.question > 0 ? accent.warm : textColor.secondary} /><Text style={st.overflowLabel}>Question</Text></TouchableOpacity>
            <TouchableOpacity style={st.overflowRow} onPress={() => { setOverflowOpen(false); openSliderModal(); }} activeOpacity={0.6}><Feather name="sliders" size={18} color={stickerCounts.slider > 0 ? accent.warm : textColor.secondary} /><Text style={st.overflowLabel}>Slider</Text></TouchableOpacity>
            <TouchableOpacity style={st.overflowRow} onPress={() => { setOverflowOpen(false); openQuizModal(); }} activeOpacity={0.6}><Feather name="check-square" size={18} color={stickerCounts.quiz > 0 ? accent.warm : textColor.secondary} /><Text style={st.overflowLabel}>Quiz</Text></TouchableOpacity>
            <View style={st.overflowDivider} />
            <View style={st.overflowRow}><Feather name="tag" size={18} color={active?.category ? accent.warm : textColor.secondary} /><View style={{ flex: 1 }}><CategoryPicker selected={active?.category || null} onChange={cat => updateActive({ category: cat })} disabled={publish.publishing} /></View></View>
            {isTextStory && <>
              <View style={st.overflowDivider} />
              <Text style={st.overflowSectionLabel}>Background</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4, gap: 8, paddingVertical: 8 }}>
                {TEXT_BG_OPTIONS.map(o => <TouchableOpacity key={o.id} style={[st.bgSwatch, active?.textBgId === o.id && st.bgSwatchActive]} onPress={() => updateActive({ textBgId: o.id, textBackground: o.bg })} activeOpacity={0.7} disabled={publish.publishing}>{o.previewColors.length === 1 ? <View style={[st.bgSwatchInner, { backgroundColor: o.previewColors[0] }, o.id === 'white' && st.bgSwatchWhite]} /> : <LinearGradient colors={o.previewColors} style={st.bgSwatchInner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />}</TouchableOpacity>)}
              </ScrollView>
            </>}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Link Modal */}
      <Modal visible={linkModalOpen} transparent animationType="slide" onRequestClose={closeLinkModal}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={closeLinkModal}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetHeader}><TouchableOpacity onPress={closeLinkModal}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>Add Link</Text><TouchableOpacity onPress={addLinkSticker} disabled={!linkLabel.trim() || !linkUrl.trim() || !isValidUrl(linkUrl.trim())}><Text style={[st.sheetDoneTxt, (!linkLabel.trim() || !linkUrl.trim()) && { opacity: 0.4 }]}>Add</Text></TouchableOpacity></View>
            <View style={st.sheetInputWrap}><TextInput value={linkLabel} onChangeText={setLinkLabel} placeholder="Label (e.g. My Website)" placeholderTextColor="rgba(255,255,255,0.4)" style={st.sheetInput} maxLength={60} autoFocus keyboardAppearance="dark" returnKeyType="next" onSubmitEditing={() => linkUrlRef.current?.focus()} blurOnSubmit={false} /></View>
            <View style={st.sheetInputWrap}><TextInput ref={linkUrlRef} value={linkUrl} onChangeText={setLinkUrl} placeholder="https://..." placeholderTextColor="rgba(255,255,255,0.4)" style={st.sheetInput} maxLength={500} autoCapitalize="none" autoCorrect={false} keyboardType="url" keyboardAppearance="dark" returnKeyType="done" onSubmitEditing={addLinkSticker} /></View>
            {linkUrl.trim().length > 0 && !isValidUrl(linkUrl.trim()) && <Text style={st.linkErrorTxt}>Enter a valid URL starting with http:// or https://</Text>}
          </View>
        </TouchableOpacity></KeyboardAvoidingView></TouchableOpacity>
      </Modal>

      {/* Location Modal */}
      <Modal visible={locationModalOpen} transparent animationType="slide" onRequestClose={closeLocationModal}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={closeLocationModal}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: SCREEN_H * 0.6 }]}>
            <View style={st.sheetHeader}><TouchableOpacity onPress={closeLocationModal}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>Add Location</Text><View style={{ width: 50 }} /></View>
            <View style={st.sheetInputWrap}><TextInput value={locationSearch} onChangeText={onLocationSearchChange} placeholder="Search a place..." placeholderTextColor="rgba(255,255,255,0.4)" style={st.sheetInput} autoFocus keyboardAppearance="dark" /></View>
            {locationLoading && <ActivityIndicator color={accent.warm} style={{ marginVertical: 12 }} />}
            {locationError && <Text style={st.locationErrorTxt}>Search failed. Try again.</Text>}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 240 }}>
              {locationResults.map((item, idx) => { const { name, subtitle } = fmtLoc(item); return (
                <TouchableOpacity key={idx} style={st.locationRow} onPress={() => addLocationSticker(item)} activeOpacity={0.6}>
                  <Feather name="map-pin" size={16} color={textColor.secondary} />
                  <View style={{ flex: 1 }}><Text style={st.locationName} numberOfLines={1}>{name}</Text>{subtitle ? <Text style={st.locationSub} numberOfLines={1}>{subtitle}</Text> : null}</View>
                </TouchableOpacity>
              ); })}
            </ScrollView>
          </View>
        </TouchableOpacity></KeyboardAvoidingView></TouchableOpacity>
      </Modal>

      {/* Mention Modal */}
      <Modal visible={mentionModalOpen} transparent animationType="slide" onRequestClose={closeMentionModal}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={closeMentionModal}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: SCREEN_H * 0.6 }]}>
            <View style={st.sheetHeader}><TouchableOpacity onPress={closeMentionModal}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>Mention Someone</Text><View style={{ width: 50 }} /></View>
            <View style={st.sheetInputWrap}><TextInput value={mentionSearch} onChangeText={onMentionSearchChange} placeholder="@username or name..." placeholderTextColor="rgba(255,255,255,0.4)" style={st.sheetInput} autoFocus autoCapitalize="none" keyboardAppearance="dark" /></View>
            {mentionLoading && <ActivityIndicator color={accent.warm} style={{ marginVertical: 12 }} />}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 240 }}>
              {mentionResults.map(u => (
                <TouchableOpacity key={u.id} style={st.mentionRow} onPress={() => addMentionSticker(u)} activeOpacity={0.6}>
                  {u.avatar_url ? <Image source={{ uri: u.avatar_url }} style={st.mentionAvatar} /> : <View style={[st.mentionAvatar, { backgroundColor: surface.secondary, alignItems: 'center', justifyContent: 'center' }]}><Feather name="user" size={14} color={textColor.secondary} /></View>}
                  <View style={{ flex: 1 }}><Text style={st.mentionName} numberOfLines={1}>{u.full_name || u.username}</Text>{u.username && <Text style={st.mentionUsername} numberOfLines={1}>@{u.username}</Text>}</View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity></KeyboardAvoidingView></TouchableOpacity>
      </Modal>

      {/* Question Modal */}
      <Modal visible={questionModalOpen} transparent animationType="slide" onRequestClose={() => { setQuestionModalOpen(false); setEditingQuestionId(null); }}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={() => { setQuestionModalOpen(false); setEditingQuestionId(null); }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetHeader}><TouchableOpacity onPress={() => { setQuestionModalOpen(false); setEditingQuestionId(null); }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>{editingQuestionId ? 'Edit Question' : 'Add Question'}</Text><TouchableOpacity onPress={saveQuestion}><Text style={st.sheetDoneTxt}>Done</Text></TouchableOpacity></View>
            <View style={st.sheetInputWrap}><TextInput value={questionPrompt} onChangeText={setQuestionPrompt} placeholder="Ask me anything..." placeholderTextColor="rgba(255,255,255,0.4)" style={st.sheetInput} maxLength={120} autoFocus keyboardAppearance="dark" /></View>
            <Text style={st.charCount}>{questionPrompt.length}/120</Text>
          </View>
        </TouchableOpacity></KeyboardAvoidingView></TouchableOpacity>
      </Modal>

      {/* Slider Modal */}
      <Modal visible={sliderModalOpen} transparent animationType="slide" onRequestClose={() => { setSliderModalOpen(false); setEditingSliderId(null); }}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={() => { setSliderModalOpen(false); setEditingSliderId(null); }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetHeader}><TouchableOpacity onPress={() => { setSliderModalOpen(false); setEditingSliderId(null); }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>{editingSliderId ? 'Edit Slider' : 'Add Slider'}</Text><TouchableOpacity onPress={saveSlider}><Text style={st.sheetDoneTxt}>Done</Text></TouchableOpacity></View>
            <View style={st.sheetInputWrap}><TextInput value={sliderLabel} onChangeText={setSliderLabel} placeholder="How much do you love...?" placeholderTextColor="rgba(255,255,255,0.4)" style={st.sheetInput} maxLength={80} autoFocus keyboardAppearance="dark" /></View>
            <View style={st.sliderEmojiRow}><Text style={st.sliderEmojiLabel}>Emoji</Text><TextInput value={sliderEmoji} onChangeText={t => setSliderEmoji(t.slice(0, 4))} style={st.sliderEmojiInput} maxLength={4} keyboardAppearance="dark" /></View>
          </View>
        </TouchableOpacity></KeyboardAvoidingView></TouchableOpacity>
      </Modal>

      {/* Quiz Modal */}
      <Modal visible={quizModalOpen} transparent animationType="slide" onRequestClose={() => { setQuizModalOpen(false); setEditingQuizId(null); }}>
        <TouchableOpacity style={st.sheetOverlay} activeOpacity={1} onPress={() => { setQuizModalOpen(false); setEditingQuizId(null); }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}><TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[st.sheetModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={st.sheetHeader}><TouchableOpacity onPress={() => { setQuizModalOpen(false); setEditingQuizId(null); }}><Text style={st.sheetCancelTxt}>Cancel</Text></TouchableOpacity><Text style={st.sheetTitle}>{editingQuizId ? 'Edit Quiz' : 'Add Quiz'}</Text><TouchableOpacity onPress={saveQuiz}><Text style={st.sheetDoneTxt}>Done</Text></TouchableOpacity></View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: SCREEN_H * 0.45 }} contentContainerStyle={{ paddingBottom: space.md }}>
              <View style={st.sheetInputWrap}><TextInput value={quizQuestion} onChangeText={setQuizQuestion} placeholder="Quiz question..." placeholderTextColor="rgba(255,255,255,0.4)" style={st.sheetInput} maxLength={120} autoFocus keyboardAppearance="dark" /></View>
              {quizOptions.map((o, i) => (
                <View key={o.id} style={st.quizOptionRow}>
                  <TouchableOpacity style={[st.quizCorrectBtn, o.isCorrect && st.quizCorrectBtnActive]} onPress={() => setQuizOptions(p => p.map((opt, idx) => ({ ...opt, isCorrect: idx === i })))}><Feather name="check" size={14} color={o.isCorrect ? '#020408' : 'rgba(255,255,255,0.4)'} /></TouchableOpacity>
                  <TextInput value={o.label} onChangeText={t => setQuizOptions(p => p.map((opt, idx) => idx === i ? { ...opt, label: t } : opt))} placeholder={`Option ${i + 1}`} placeholderTextColor="rgba(255,255,255,0.3)" style={st.quizOptionInput} maxLength={40} keyboardAppearance="dark" />
                  {quizOptions.length > 2 && <TouchableOpacity onPress={() => removeQuizOption(i)} style={st.pollRemoveBtn}><Feather name="x" size={16} color="rgba(255,255,255,0.5)" /></TouchableOpacity>}
                </View>
              ))}
              {quizOptions.length < 4 && <TouchableOpacity onPress={addQuizOption} style={st.pollAddBtn}><Feather name="plus" size={14} color="rgba(255,255,255,0.6)" /><Text style={st.pollAddTxt}>Add option</Text></TouchableOpacity>}
              <Text style={st.quizHint}>Tap the checkmark to mark the correct answer</Text>
            </ScrollView>
          </View>
        </TouchableOpacity></KeyboardAvoidingView></TouchableOpacity>
      </Modal>

      {/* Enhancement Modal */}
      <EnhancerModal
        visible={enhancement.enhancerOpen}
        state={enhancement.state}
        variations={enhancement.variations}
        selectedIndex={enhancement.selectedIndex}
        failureMessage={enhancement.failureMessage}
        faceDetected={enhancement.faceDetected}
        originalUri={(active as any)?.originalUri || active?.localUri || null}
        localUri={active?.localUri || null}
        isDual={isDual}
        enhancingFront={arrangement.primaryCamera === 'front'}
        onGenerate={enhancement.generateEnhancements}
        onCancel={enhancement.cancelGeneration}
        onSelect={enhancement.selectVariation}
        onApply={enhancement.applyVariation}
        onDiscard={enhancement.discardVariations}
        onRetry={enhancement.retryGeneration}
        onClose={enhancement.closeEnhancer}
        userId={myId || ''}
        selectedReferenceUrl={enhancement.selectedReferenceUrl}
        onSelectReference={enhancement.setSelectedReferenceUrl}
        stableOriginalUri={enhancement.stableOriginalUri}
        intensity={enhancement.enhancementIntensity}
        onIntensityChange={enhancement.setEnhancementIntensity}
      />

      {/* Identity Training Wizard */}
      <IdentityTrainingWizard
        visible={enhancement.trainingWizardOpen}
        userId={myId || ''}
        onComplete={enhancement.onTrainingComplete}
        onSkip={enhancement.onTrainingSkip}
        onClose={enhancement.closeTrainingWizard}
      />

    </TouchableOpacity>
  );
}

// ════════════════════════════════════════════════════════════
// STYLES (renamed from 's' to 'st' to avoid collision with function params)
// ════════════════════════════════════════════════════════════

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.warmWhite },
  safe: { flex: 1, backgroundColor: palette.warmWhite },
  canvasFrame: { flex: 1, overflow: 'hidden', position: 'relative', backgroundColor: surface.immersive, ...SHADOW_CANVAS },
  canvasInner: { flex: 1, position: 'relative' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 120, zIndex: Z_SCRIM, pointerEvents: 'none' as const },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 140, zIndex: Z_SCRIM, pointerEvents: 'none' as const },
  dualBubble: { position: 'absolute', zIndex: Z_BUBBLE, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', ...SHADOW_BUBBLE },
  dualBubbleImg: { width: '100%', height: '100%' },
  closeBtn: { position: 'absolute', left: 12, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', zIndex: Z_CHROME },
  closeBtnInner: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  undoRedoWrap: { position: 'absolute', right: 10, flexDirection: 'row', gap: 4, zIndex: Z_CHROME },
  undoBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  captionFloating: { position: 'absolute', left: 14, right: 100, zIndex: 50 },
  captionInput: { backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: '#FFF', fontSize: typeSize.caption, fontWeight: fontWeight.medium, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' },
  postPillWrap: { position: 'absolute', right: 14, zIndex: Z_CHROME },
  postPillInner: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, backgroundColor: accent.warm, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 },
  postPillTxt: { color: '#FFF', fontSize: typeSize.caption, fontWeight: fontWeight.bold },
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
  thumbWrap: { width: 48, height: 64, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', position: 'relative' },
  thumbWrapActive: { borderColor: accent.warmMuted },
  thumb: { width: '100%', height: '100%', backgroundColor: surface.immersive },
  videoIndicator: { position: 'absolute', bottom: 2, left: 2, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: 2 },
  thumbDone: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(52,199,89,0.5)', alignItems: 'center', justifyContent: 'center' } as any,
  thumbError: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,59,48,0.5)', alignItems: 'center', justifyContent: 'center' } as any,
  thumbRemove: { position: 'absolute', top: -1, right: -1, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  textEditorOverlay: { flex: 1, backgroundColor: 'rgba(2,4,8,0.92)' },
  textEditorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  textEditorCancel: { color: textColor.secondary, fontSize: typeSize.body, fontWeight: fontWeight.medium },
  textEditorDone: { color: accent.warm, fontSize: typeSize.body, fontWeight: fontWeight.bold },
  editorActionBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: surface.secondary, alignItems: 'center', justifyContent: 'center' },
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
  emojiTray: { backgroundColor: surface.primary, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 16 },
  emojiHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  emojiTitle: { color: '#FFF', fontSize: typeSize.body, fontWeight: fontWeight.bold },
  emojiDeleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255,59,48,0.15)' },
  emojiDeleteTxt: { color: '#FF3B30', fontSize: typeSize.micro, fontWeight: fontWeight.semibold },
  emojiDuplicateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: surface.secondary },
  emojiDuplicateTxt: { color: '#FFF', fontSize: typeSize.micro, fontWeight: fontWeight.semibold },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  emojiCell: { width: (SCREEN_W - 32 - 36) / 10, height: 40, alignItems: 'center', justifyContent: 'center' },
  emojiCellTxt: { fontSize: 24 },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetModal: { backgroundColor: surface.primary, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 16 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetCancelTxt: { color: textColor.secondary, fontSize: typeSize.body, fontWeight: fontWeight.medium },
  sheetTitle: { color: '#FFF', fontSize: typeSize.body, fontWeight: fontWeight.bold },
  sheetDoneTxt: { color: accent.warm, fontSize: typeSize.body, fontWeight: fontWeight.bold },
  sheetInputWrap: { marginBottom: 12 },
  sheetInput: { color: '#FFF', fontSize: typeSize.body, fontWeight: fontWeight.medium, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor.default, paddingVertical: space.sm, padding: 0 },
  pollOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  pollOptionInput: { flex: 1, color: '#FFF', fontSize: typeSize.caption, fontWeight: fontWeight.medium, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor.soft, paddingVertical: space.xs, padding: 0 },
  pollRemoveBtn: { padding: 4 },
  pollAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  pollAddTxt: { color: 'rgba(255,255,255,0.6)', fontSize: typeSize.caption, fontWeight: fontWeight.medium },
  overflowSheet: { backgroundColor: surface.primary, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingHorizontal: 16 },
  overflowHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'center', marginBottom: 12 },
  overflowRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  overflowLabel: { color: textColor.primary, fontSize: typeSize.body, fontWeight: fontWeight.medium },
  overflowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: borderColor.soft, marginVertical: 4 },
  overflowSectionLabel: { color: textColor.secondary, fontSize: typeSize.micro, fontWeight: fontWeight.semibold, paddingHorizontal: 4, paddingTop: 4 },
  bgSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  bgSwatchActive: { borderColor: accent.warm },
  bgSwatchInner: { flex: 1, borderRadius: 16 },
  bgSwatchWhite: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
  linkErrorTxt: { color: '#FF6B6B', fontSize: typeSize.micro, fontWeight: fontWeight.medium, paddingHorizontal: 4, paddingTop: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor.soft },
  locationName: { color: '#FFF', fontSize: typeSize.caption, fontWeight: fontWeight.semibold },
  locationSub: { color: textColor.secondary, fontSize: typeSize.micro, marginTop: 2 },
  locationErrorTxt: { color: '#FF6B6B', fontSize: typeSize.micro, fontWeight: fontWeight.medium, textAlign: 'center', paddingVertical: 12 },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor.soft },
  mentionAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: surface.secondary },
  mentionName: { color: '#FFF', fontSize: typeSize.caption, fontWeight: fontWeight.semibold },
  mentionUsername: { color: textColor.secondary, fontSize: typeSize.micro, marginTop: 1 },
  charCount: { color: textColor.faint, fontSize: typeSize.micro, textAlign: 'right', paddingHorizontal: 4, paddingTop: 4 },
  sliderEmojiRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 4 },
  sliderEmojiLabel: { color: textColor.secondary, fontSize: typeSize.caption, fontWeight: fontWeight.medium },
  sliderEmojiInput: { color: '#FFF', fontSize: 24, width: 48, textAlign: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor.default, paddingVertical: 4 },
  quizOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  quizCorrectBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  quizCorrectBtnActive: { backgroundColor: '#34C759', borderColor: '#34C759' },
  quizOptionInput: { flex: 1, color: '#FFF', fontSize: typeSize.caption, fontWeight: fontWeight.medium, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor.soft, paddingVertical: space.xs, padding: 0 },
  quizHint: { color: textColor.faint, fontSize: typeSize.micro, textAlign: 'center', paddingTop: 8 },
});
