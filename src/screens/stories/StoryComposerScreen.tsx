import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
  Dimensions,
  Pressable,
  ScrollView,
  Animated,
  PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { VideoView, useVideoPlayer } from 'expo-video';
import { storiesService, StoryMediaType } from '../../services/storiesService';
import { useAuthStore } from '../../stores/authStore';

type StickerStyle = 'classic' | 'bold' | 'typewriter' | 'neon' | 'highlight';

export type TextSticker = {
  id: string;
  text: string;
  style: StickerStyle;
  color: string;
  nx: number;
  ny: number;
  scale: number;
  rotation: number;
};

export type TextStoryBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; colors: [string, string]; direction: 'vertical' | 'diagonal' };

type Draft = {
  id: string;
  localUri: string | null;
  mediaType: 'image' | 'video' | 'text';
  thumbnailLocalUri?: string | null;
  durationSec?: number | null;
  caption: string;
  scope: 'institution' | 'global';
  uploadState: 'idle' | 'uploading' | 'done' | 'error';
  errorMsg?: string | null;
  stickers: TextSticker[];
  textBackground?: TextStoryBackground | null;
  textBody?: string;
};

const VIDEO_MAX_SEC = 15;
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

const STYLE_PRESETS: Array<{ id: StickerStyle; label: string }> = [
  { id: 'classic',    label: 'Classic' },
  { id: 'bold',       label: 'Bold' },
  { id: 'typewriter', label: 'Type' },
  { id: 'neon',       label: 'Neon' },
  { id: 'highlight',  label: 'Highlight' },
];

const COLOR_PALETTE = [
  '#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFCC00',
  '#34C759', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55',
];

const TEXT_BG_SOLIDS: string[] = [
  '#0B1E3D', '#1F2937', '#7C2D12', '#065F46', '#1E3A8A',
  '#7C3AED', '#BE185D', '#B45309', '#111827', '#0F766E',
];

const TEXT_BG_GRADIENTS: Array<{ colors: [string, string]; direction: 'vertical' | 'diagonal' }> = [
  { colors: ['#F59E0B', '#DC2626'], direction: 'diagonal' },
  { colors: ['#8B5CF6', '#EC4899'], direction: 'diagonal' },
  { colors: ['#0EA5E9', '#6366F1'], direction: 'vertical' },
  { colors: ['#10B981', '#0EA5E9'], direction: 'diagonal' },
  { colors: ['#F43F5E', '#8B5CF6'], direction: 'vertical' },
  { colors: ['#FBBF24', '#F472B6'], direction: 'diagonal' },
  { colors: ['#111827', '#6366F1'], direction: 'vertical' },
  { colors: ['#0F766E', '#0B1E3D'], direction: 'diagonal' },
];

export function stickerTextStyle(style: StickerStyle, color: string) {
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

function newStickerId() {
  return `stk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function newDraftId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function StoryComposerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  const initialMode: 'image' | 'video' | 'text' = route.params?.mode ?? 'image';
  const initialAssets: any[] = route.params?.assets ?? [];

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [publishing, setPublishing] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorStickerId, setEditorStickerId] = useState<string | null>(null);
  const [editorText, setEditorText] = useState('');
  const [editorStyle, setEditorStyle] = useState<StickerStyle>('classic');
  const [editorColor, setEditorColor] = useState('#FFFFFF');
  const [editorInitialNx, setEditorInitialNx] = useState<number>(0.5);
  const [editorInitialNy, setEditorInitialNy] = useState<number>(0.5);

  const [bgPickerOpen, setBgPickerOpen] = useState(false);

  const [previewSize, setPreviewSize] = useState({ w: SCREEN_W, h: SCREEN_H * 0.6 });

  const active = drafts[activeIndex];
  const isVideo = active?.mediaType === 'video';
  const isText = active?.mediaType === 'text';

  const videoPlayer = useVideoPlayer(
    isVideo && active?.localUri ? active.localUri : null,
    (player) => {
      if (player) { player.loop = true; player.muted = false; player.play(); }
    }
  );

  // Initialize drafts from route params (from StoryCreationMenu or direct entry).
  useEffect(() => {
    if (drafts.length > 0) return;

    const init = async () => {
      if (initialMode === 'text') {
        setDrafts([{
          id: newDraftId(),
          localUri: null,
          mediaType: 'text',
          caption: '',
          scope: 'institution',
          uploadState: 'idle',
          stickers: [],
          textBackground: { kind: 'gradient', colors: ['#8B5CF6', '#EC4899'], direction: 'diagonal' },
          textBody: '',
        }]);
        return;
      }

      if (initialAssets.length > 0) {
        const newDrafts: Draft[] = [];
        for (const asset of initialAssets) {
          const isVid = asset.type === 'video';
          let thumbnailUri: string | null = null;
          if (isVid) {
            try {
              const { uri } = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 500, quality: 0.7 });
              thumbnailUri = uri;
            } catch {}
          }
          const durationSec = isVid && asset.duration
            ? Math.min(Math.round(asset.duration / 1000), VIDEO_MAX_SEC)
            : null;

          newDrafts.push({
            id: newDraftId(),
            localUri: asset.uri,
            mediaType: isVid ? 'video' : 'image',
            thumbnailLocalUri: thumbnailUri,
            durationSec,
            caption: '',
            scope: 'institution',
            uploadState: 'idle',
            stickers: [],
          });
        }
        setDrafts(newDrafts);
      }
    };

    init();
  }, []);

  const updateActive = useCallback((patch: Partial<Draft>) => {
    setDrafts(prev => prev.map((d, i) => (i === activeIndex ? { ...d, ...patch } : d)));
  }, [activeIndex]);

  const updateSticker = useCallback((stickerId: string, patch: Partial<TextSticker>) => {
    setDrafts(prev => prev.map((d, i) => {
      if (i !== activeIndex) return d;
      return { ...d, stickers: d.stickers.map(st => st.id === stickerId ? { ...st, ...patch } : st) };
    }));
  }, [activeIndex]);

  const removeSticker = useCallback((stickerId: string) => {
    setDrafts(prev => prev.map((d, i) => {
      if (i !== activeIndex) return d;
      return { ...d, stickers: d.stickers.filter(st => st.id !== stickerId) };
    }));
  }, [activeIndex]);

  const removeDraft = useCallback((index: number) => {
    setDrafts(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) { setActiveIndex(0); return next; }
      if (activeIndex >= next.length) setActiveIndex(next.length - 1);
      else if (activeIndex > index) setActiveIndex(activeIndex - 1);
      return next;
    });
  }, [activeIndex]);

  const openStickerEditor = useCallback((existingId?: string, initialNx?: number, initialNy?: number) => {
    if (existingId) {
      const st = active?.stickers.find(x => x.id === existingId);
      if (!st) return;
      setEditorStickerId(existingId);
      setEditorText(st.text);
      setEditorStyle(st.style);
      setEditorColor(st.color);
      setEditorInitialNx(st.nx);
      setEditorInitialNy(st.ny);
    } else {
      setEditorStickerId(null);
      setEditorText('');
      setEditorStyle('classic');
      setEditorColor('#FFFFFF');
      setEditorInitialNx(initialNx ?? 0.5);
      setEditorInitialNy(initialNy ?? 0.5);
    }
    setEditorOpen(true);
  }, [active]);

  const saveStickerEditor = useCallback(() => {
    const text = editorText.trim();
    if (!text) {
      setEditorOpen(false);
      return;
    }
    if (editorStickerId) {
      updateSticker(editorStickerId, { text, style: editorStyle, color: editorColor });
    } else {
      const newSticker: TextSticker = {
        id: newStickerId(),
        text,
        style: editorStyle,
        color: editorColor,
        nx: editorInitialNx,
        ny: editorInitialNy,
        scale: 1,
        rotation: 0,
      };
      setDrafts(prev => prev.map((d, i) =>
        i === activeIndex ? { ...d, stickers: [...d.stickers, newSticker] } : d
      ));
    }
    setEditorOpen(false);
  }, [editorText, editorStickerId, editorStyle, editorColor, editorInitialNx, editorInitialNy, updateSticker, activeIndex]);

  const handlePreviewTap = useCallback((e: any) => {
    if (publishing) return;
    if (!previewSize.w || !previewSize.h) return;
    // Convert tap location to normalized coordinates within the preview area.
    const { locationX, locationY } = e.nativeEvent;
    const nx = Math.max(0.05, Math.min(0.95, locationX / previewSize.w));
    const ny = Math.max(0.05, Math.min(0.95, locationY / previewSize.h));
    openStickerEditor(undefined, nx, ny);
  }, [publishing, previewSize, openStickerEditor]);

  const publishAll = useCallback(async () => {
    if (!myId || publishing || drafts.length === 0) return;

    // Validate text drafts have content.
    for (const d of drafts) {
      if (d.mediaType === 'text' && !(d.textBody?.trim() || d.stickers.length > 0)) {
        Alert.alert('Empty text story', 'Add some text before posting.');
        return;
      }
    }

    setPublishing(true);

    let successCount = 0, failCount = 0;

    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      if (d.uploadState === 'done') { successCount++; continue; }

      setDrafts(prev => prev.map((x, idx) => idx === i ? { ...x, uploadState: 'uploading', errorMsg: null } : x));

      try {
        // For text stories, merge the text body as a single sticker if no stickers exist,
        // or prepend it as the primary sticker so StoryViewer can render it.
        let stickersForPayload: TextSticker[] = [...d.stickers];
        if (d.mediaType === 'text' && d.textBody?.trim()) {
          stickersForPayload = [
            {
              id: 'text_body',
              text: d.textBody.trim(),
              style: 'bold',
              color: '#FFFFFF',
              nx: 0.5,
              ny: 0.5,
              scale: 1,
              rotation: 0,
            },
            ...stickersForPayload,
          ];
        }

        await storiesService.uploadAndCreateStory({
          userId: myId,
          localUri: d.localUri,
          mediaType: d.mediaType,
          caption: d.caption || null,
          scope: d.scope,
          durationSec: d.durationSec ?? null,
          thumbnailLocalUri: d.thumbnailLocalUri ?? null,
          stickersJson: stickersForPayload.length > 0 ? stickersForPayload : null,
          textBackground: d.mediaType === 'text' ? d.textBackground ?? null : null,
        } as any);

        setDrafts(prev => prev.map((x, idx) => idx === i ? { ...x, uploadState: 'done' } : x));
        successCount++;
      } catch (e: any) {
        console.log('[StoryComposer publish]', e?.message);
        setDrafts(prev => prev.map((x, idx) =>
          idx === i ? { ...x, uploadState: 'error', errorMsg: e?.message || 'Upload failed' } : x
        ));
        failCount++;
      }
    }

    setPublishing(false);

    if (failCount === 0) {
      Alert.alert('Posted!', `${successCount} ${successCount === 1 ? 'story' : 'stories'} uploaded.`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } else if (successCount === 0) {
      Alert.alert('Upload failed', 'Could not upload your stories. Please try again.');
    } else {
      Alert.alert('Partial upload', `${successCount} uploaded, ${failCount} failed.`);
    }
  }, [myId, publishing, drafts, navigation]);

  const canPublish = drafts.length > 0 && !publishing;

  if (drafts.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <StatusBar barStyle="light-content" />
        <View style={s.loading}>
          <ActivityIndicator color="#FFF" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.closeBtn}>
            <Feather name="x" size={22} color="#FFF" />
          </TouchableOpacity>
          <Text style={s.headerTitleDark}>{activeIndex + 1} / {drafts.length}</Text>
          <TouchableOpacity
            onPress={publishAll}
            disabled={!canPublish}
            style={[s.publishBtn, !canPublish && { opacity: 0.5 }]}
          >
            {publishing ? <ActivityIndicator color="#FFF" size={16} />
              : <Text style={s.publishBtnTxt}>Share {drafts.length > 1 ? `(${drafts.length})` : ''}</Text>}
          </TouchableOpacity>
        </View>

        {/* Preview wrapper. This is the tap-to-type surface. */}
        <Pressable
          style={s.previewWrap}
          onPress={handlePreviewTap}
          onLayout={e => setPreviewSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          {/* Background layer */}
          {isText ? (
            <TextStoryBackgroundView background={active.textBackground ?? null} />
          ) : isVideo ? (
            <VideoView
              style={s.previewMedia}
              player={videoPlayer}
              contentFit="cover"
              nativeControls={false}
            />
          ) : active?.localUri ? (
            <Image source={{ uri: active.localUri }} style={s.previewMedia} resizeMode="cover" />
          ) : null}

          {/* Text body input for text stories. Centered, always tappable. */}
          {isText && (
            <View style={s.textBodyWrap} pointerEvents="box-none">
              <TextInput
                value={active.textBody ?? ''}
                onChangeText={t => updateActive({ textBody: t })}
                placeholder="Type your story..."
                placeholderTextColor="rgba(255,255,255,0.55)"
                style={s.textBodyInput}
                multiline
                maxLength={500}
                editable={!publishing}
              />
            </View>
          )}

          {/* Sticker overlay. Each sticker consumes its own touches so parent onPress won't fire. */}
          {active?.stickers.map(st => (
            <DraggableSticker
              key={st.id}
              sticker={st}
              containerW={previewSize.w}
              containerH={previewSize.h}
              onUpdate={(patch) => updateSticker(st.id, patch)}
              onDoubleTap={() => openStickerEditor(st.id)}
              onRequestDelete={() => removeSticker(st.id)}
              disabled={publishing}
            />
          ))}

          {/* Hint for empty image/video preview */}
          {!isText && active?.stickers.length === 0 && active?.uploadState === 'idle' && (
            <View style={s.tapHint} pointerEvents="none">
              <View style={s.tapHintPill}>
                <Feather name="type" size={14} color="#FFF" />
                <Text style={s.tapHintTxt}>Tap anywhere to add text</Text>
              </View>
            </View>
          )}

          {active?.uploadState === 'uploading' && (
            <View style={s.uploadOverlay}>
              <ActivityIndicator size="large" color="#FFF" />
              <Text style={s.uploadOverlayTxt}>Uploading...</Text>
            </View>
          )}
          {active?.uploadState === 'done' && (
            <View style={s.doneOverlay}>
              <Feather name="check-circle" size={40} color="#34C759" />
              <Text style={s.doneOverlayTxt}>Posted</Text>
            </View>
          )}
          {active?.uploadState === 'error' && (
            <View style={s.errorOverlay}>
              <Feather name="alert-circle" size={40} color="#FF3B30" />
              <Text style={s.errorOverlayTxt}>{active.errorMsg || 'Upload failed'}</Text>
            </View>
          )}

          {/* Tool FABs, right side */}
          {active?.uploadState !== 'uploading' && active?.uploadState !== 'done' && (
            <View style={s.fabColumn} pointerEvents="box-none">
              {isText && (
                <TouchableOpacity style={s.fabBtn}
                  onPress={(e) => { e.stopPropagation?.(); setBgPickerOpen(true); }}
                  activeOpacity={0.8}
                >
                  <Feather name="droplet" size={18} color="#FFF" />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.fabBtn}
                onPress={(e) => { e.stopPropagation?.(); openStickerEditor(); }}
                activeOpacity={0.8}
              >
                <Feather name="type" size={18} color="#FFF" />
              </TouchableOpacity>
            </View>
          )}
        </Pressable>

        <View style={s.captionWrap}>
          <TextInput
            value={active?.caption || ''}
            onChangeText={(t) => updateActive({ caption: t })}
            placeholder="Add a caption..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            style={s.captionInput}
            maxLength={200}
            editable={!publishing}
          />
        </View>

        <View style={s.scopeWrap}>
          <TouchableOpacity
            style={[s.scopePill, active?.scope === 'institution' && s.scopePillActive]}
            onPress={() => updateActive({ scope: 'institution' })}
            disabled={publishing}
          >
            <Feather name="award" size={13} color={active?.scope === 'institution' ? '#FFF' : '#DDD'} />
            <Text style={[s.scopePillTxt, active?.scope === 'institution' && s.scopePillTxtActive]}>My School</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.scopePill, active?.scope === 'global' && s.scopePillActive]}
            onPress={() => updateActive({ scope: 'global' })}
            disabled={publishing}
          >
            <Feather name="globe" size={13} color={active?.scope === 'global' ? '#FFF' : '#DDD'} />
            <Text style={[s.scopePillTxt, active?.scope === 'global' && s.scopePillTxtActive]}>Global</Text>
          </TouchableOpacity>
        </View>

        {drafts.length > 1 && (
          <View style={[s.stripWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <FlatList
              data={drafts}
              keyExtractor={(d) => d.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
              renderItem={({ item, index }) => {
                const isActive = index === activeIndex;
                const thumbUri = item.mediaType === 'video'
                  ? item.thumbnailLocalUri || item.localUri
                  : item.localUri;
                return (
                  <TouchableOpacity
                    style={[s.thumbWrap, isActive && s.thumbWrapActive]}
                    activeOpacity={0.7}
                    onPress={() => setActiveIndex(index)}
                    disabled={publishing}
                  >
                    {item.mediaType === 'text' ? (
                      <View style={[s.thumb, s.thumbText]}>
                        <TextStoryBackgroundView background={item.textBackground ?? null} small />
                      </View>
                    ) : thumbUri ? (
                      <Image source={{ uri: thumbUri }} style={s.thumb} />
                    ) : (
                      <View style={s.thumb} />
                    )}
                    {item.mediaType === 'video' && (
                      <View style={s.badgeTL}><Feather name="video" size={10} color="#FFF" /></View>
                    )}
                    {item.mediaType === 'text' && (
                      <View style={s.badgeTL}><Feather name="type" size={10} color="#FFF" /></View>
                    )}
                    {item.stickers.length > 0 && (
                      <View style={s.badgeTR}><Feather name="type" size={10} color="#FFF" /></View>
                    )}
                    {item.uploadState === 'done' && (
                      <View style={s.thumbDone}><Feather name="check" size={14} color="#FFF" /></View>
                    )}
                    {item.uploadState === 'error' && (
                      <View style={s.thumbError}><Feather name="alert-circle" size={14} color="#FFF" /></View>
                    )}
                    {!publishing && item.uploadState !== 'done' && drafts.length > 1 && (
                      <TouchableOpacity style={s.thumbRemove}
                        onPress={() => removeDraft(index)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Feather name="x" size={11} color="#FFF" />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      {editorOpen && (
        <Pressable style={s.editorBackdrop} onPress={saveStickerEditor}>
          <KeyboardAvoidingView
            style={{ flex: 1, justifyContent: 'center' }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <Pressable onPress={() => {}}>
              <View style={s.editorWrap}>
                <View style={s.editorHeader}>
                  {editorStickerId && (
                    <TouchableOpacity
                      style={s.editorTrash}
                      onPress={() => {
                        if (editorStickerId) removeSticker(editorStickerId);
                        setEditorOpen(false);
                      }}
                    >
                      <Feather name="trash-2" size={18} color="#FF3B30" />
                    </TouchableOpacity>
                  )}
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity style={s.editorDone} onPress={saveStickerEditor}>
                    <Text style={s.editorDoneTxt}>Done</Text>
                  </TouchableOpacity>
                </View>

                <View style={s.editorPreview}>
                  <StickerTextView text={editorText || 'Your text'} style={editorStyle} color={editorColor} />
                </View>

                <TextInput
                  value={editorText}
                  onChangeText={setEditorText}
                  placeholder="Type something..."
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  style={s.editorInput}
                  multiline
                  autoFocus
                  maxLength={120}
                />

                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingTop: 10 }}
                  style={{ flexGrow: 0 }}
                >
                  {STYLE_PRESETS.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[s.styleChip, editorStyle === p.id && s.styleChipActive]}
                      onPress={() => setEditorStyle(p.id)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.styleChipTxt, editorStyle === p.id && s.styleChipTxtActive]}>
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 12, gap: 10, paddingTop: 12, paddingBottom: 6 }}
                  style={{ flexGrow: 0 }}
                >
                  {COLOR_PALETTE.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        s.colorSwatch,
                        { backgroundColor: c },
                        editorColor === c && s.colorSwatchActive,
                      ]}
                      onPress={() => setEditorColor(c)}
                    />
                  ))}
                </ScrollView>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      )}

      {/* Text background picker */}
      {bgPickerOpen && (
        <Pressable style={s.bgPickerBackdrop} onPress={() => setBgPickerOpen(false)}>
          <Pressable onPress={() => {}} style={s.bgPickerSheet}>
            <View style={s.bgPickerHandle} />
            <Text style={s.bgPickerTitle}>Background</Text>

            <Text style={s.bgSectionLabel}>COLORS</Text>
            <View style={s.bgGrid}>
              {TEXT_BG_SOLIDS.map(color => {
                const selected = active?.textBackground?.kind === 'solid' && active?.textBackground?.color === color;
                return (
                  <TouchableOpacity
                    key={`solid-${color}`}
                    style={[s.bgTile, { backgroundColor: color }, selected && s.bgTileSelected]}
                    onPress={() => {
                      updateActive({ textBackground: { kind: 'solid', color } });
                      setBgPickerOpen(false);
                    }}
                    activeOpacity={0.8}
                  />
                );
              })}
            </View>

            <Text style={s.bgSectionLabel}>GRADIENTS</Text>
            <View style={s.bgGrid}>
              {TEXT_BG_GRADIENTS.map((g, idx) => {
                const selected = active?.textBackground?.kind === 'gradient'
                  && active?.textBackground?.colors[0] === g.colors[0]
                  && active?.textBackground?.colors[1] === g.colors[1];
                return (
                  <TouchableOpacity
                    key={`grad-${idx}`}
                    style={[s.bgTile, selected && s.bgTileSelected]}
                    onPress={() => {
                      updateActive({ textBackground: { kind: 'gradient', colors: g.colors, direction: g.direction } });
                      setBgPickerOpen(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <GradientStripes colors={g.colors} direction={g.direction} />
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ height: insets.bottom + 12 }} />
          </Pressable>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

export function StickerTextView({
  text, style, color,
}: { text: string; style: StickerStyle; color: string }) {
  const { textStyle, wrapperStyle } = stickerTextStyle(style, color);
  return (
    <View style={wrapperStyle}>
      <Text style={textStyle}>{text}</Text>
    </View>
  );
}

// Simple CSS-less gradient simulation using stacked color bands.
// Works without any native gradient library.
function GradientStripes({
  colors, direction,
}: { colors: [string, string]; direction: 'vertical' | 'diagonal' }) {
  const STEPS = 12;
  const stripes = [];
  for (let i = 0; i < STEPS; i++) {
    const t = i / (STEPS - 1);
    const col = lerpColor(colors[0], colors[1], t);
    stripes.push(
      <View
        key={i}
        style={{
          flex: 1,
          backgroundColor: col,
        }}
      />
    );
  }
  return (
    <View style={{
      ...StyleSheet.absoluteFillObject,
      flexDirection: direction === 'diagonal' ? 'row' : 'column',
    }}>
      {stripes}
    </View>
  );
}

function TextStoryBackgroundView({
  background, small,
}: { background: TextStoryBackground | null; small?: boolean }) {
  if (!background) {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111827' }]} />;
  }
  if (background.kind === 'solid') {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: background.color }]} />;
  }
  return <GradientStripes colors={background.colors} direction={background.direction} />;
}

// Linear interpolation between two hex colors.
function lerpColor(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const v = parseInt(h, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

type DistanceState = { startDistance: number; startScale: number };

function getDistance(touches: any[]): number {
  if (touches.length < 2) return 0;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function DraggableSticker({
  sticker, containerW, containerH, onUpdate, onDoubleTap, onRequestDelete, disabled,
}: {
  sticker: TextSticker;
  containerW: number;
  containerH: number;
  onUpdate: (patch: Partial<TextSticker>) => void;
  onDoubleTap: () => void;
  onRequestDelete: () => void;
  disabled: boolean;
}) {
  const pan = useRef(new Animated.ValueXY({
    x: sticker.nx * containerW,
    y: sticker.ny * containerH,
  })).current;
  const scaleAnim = useRef(new Animated.Value(sticker.scale)).current;

  const basePos = useRef({ x: sticker.nx * containerW, y: sticker.ny * containerH });
  const baseScale = useRef(sticker.scale);
  const pinchState = useRef<DistanceState | null>(null);
  const lastTap = useRef(0);
  const longPressTimer = useRef<any>(null);
  const moved = useRef(false);

  useEffect(() => {
    const nx = sticker.nx * containerW;
    const ny = sticker.ny * containerH;
    pan.setValue({ x: nx, y: ny });
    scaleAnim.setValue(sticker.scale);
    basePos.current = { x: nx, y: ny };
    baseScale.current = sticker.scale;
  }, [sticker.nx, sticker.ny, sticker.scale, containerW, containerH]);

  const commit = useCallback((x: number, y: number, sc: number) => {
    if (containerW <= 0 || containerH <= 0) return;
    // No clamping. Let it land anywhere, even off-screen.
    onUpdate({
      nx: x / containerW,
      ny: y / containerH,
      scale: sc,
    });
  }, [onUpdate, containerW, containerH]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: () => {
        moved.current = false;
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        longPressTimer.current = setTimeout(() => {
          if (!moved.current) {
            onRequestDelete();
          }
        }, 600);
      },

      onPanResponderMove: (evt, gesture) => {
        const touches = evt.nativeEvent.touches;

        if (Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3) {
          moved.current = true;
          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
          }
        }

        if (touches.length >= 2) {
          const dist = getDistance(touches);
          if (!pinchState.current) {
            pinchState.current = {
              startDistance: dist,
              startScale: baseScale.current,
            };
          } else if (pinchState.current.startDistance > 0) {
            const ratio = dist / pinchState.current.startDistance;
            const nextScale = Math.max(0.3, Math.min(5, pinchState.current.startScale * ratio));
            scaleAnim.setValue(nextScale);
          }
        } else {
          pinchState.current = null;
          pan.setValue({
            x: basePos.current.x + gesture.dx,
            y: basePos.current.y + gesture.dy,
          });
        }
      },

      onPanResponderRelease: (evt, gesture) => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }

        const finalX = basePos.current.x + gesture.dx;
        const finalY = basePos.current.y + gesture.dy;
        const finalScale = (scaleAnim as any)._value ?? baseScale.current;

        basePos.current = { x: finalX, y: finalY };
        baseScale.current = finalScale;
        pinchState.current = null;

        if (!moved.current) {
          const now = Date.now();
          if (now - lastTap.current < 280) {
            onDoubleTap();
            lastTap.current = 0;
            return;
          }
          lastTap.current = now;
        }

        commit(finalX, finalY, finalScale);
      },

      onPanResponderTerminate: () => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        pinchState.current = null;
      },
    })
  ).current;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transform: [
          { translateX: pan.x },
          { translateY: pan.y },
          { scale: scaleAnim },
        ],
      }}
    >
      <View style={{ alignItems: 'center', justifyContent: 'center', marginLeft: -80, marginTop: -25, width: 160 }}>
        <StickerTextView text={sticker.text} style={sticker.style} color={sticker.color} />
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
  },
  closeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitleDark: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  publishBtn: {
    backgroundColor: '#007AFF', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 18, minWidth: 84, alignItems: 'center',
  },
  publishBtnTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  previewWrap: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  previewMedia: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },

  textBodyWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  textBodyInput: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    minHeight: 80,
    width: '100%',
  },

  tapHint: { position: 'absolute', top: 74, left: 0, right: 0, alignItems: 'center' },
  tapHintPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14,
  },
  tapHintTxt: { color: '#FFF', fontSize: 12, fontWeight: '600' },

  fabColumn: {
    position: 'absolute',
    right: 12, top: 74, gap: 10,
  },
  fabBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)',
  },

  uploadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 12 },
  uploadOverlayTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  doneOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  doneOverlayTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  errorOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  errorOverlayTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', textAlign: 'center' },

  captionWrap: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.55)' },
  captionInput: { color: '#FFFFFF', fontSize: 15, paddingVertical: 8, paddingHorizontal: 4 },

  scopeWrap: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: 'rgba(0,0,0,0.55)' },
  scopePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  scopePillActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  scopePillTxt: { fontSize: 12, fontWeight: '600', color: '#DDDDDD' },
  scopePillTxtActive: { color: '#FFFFFF' },

  stripWrap: { paddingTop: 10, backgroundColor: '#000000' },
  thumbWrap: {
    width: 56, height: 56, borderRadius: 10, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent', position: 'relative',
  },
  thumbWrapActive: { borderColor: '#007AFF' },
  thumb: { width: '100%', height: '100%' },
  thumbText: { overflow: 'hidden' },
  badgeTL: {
    position: 'absolute', top: 3, left: 3,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  badgeTR: {
    position: 'absolute', top: 3, right: 3,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,122,255,0.85)',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbDone: {
    position: 'absolute', bottom: 3, right: 3,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#34C759',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbError: {
    position: 'absolute', bottom: 3, right: 3,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#FF3B30',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbRemove: {
    position: 'absolute', top: 2, right: 2,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },

  editorBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
    zIndex: 100,
  },
  editorWrap: {
    marginHorizontal: 12, marginBottom: 16,
    backgroundColor: 'rgba(28,28,30,0.98)', borderRadius: 18,
    paddingTop: 10, paddingBottom: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)',
  },
  editorHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 4,
  },
  editorTrash: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,59,48,0.15)',
  },
  editorDone: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: '#007AFF' },
  editorDoneTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  editorPreview: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 18, paddingHorizontal: 16, minHeight: 80,
  },
  editorInput: {
    color: '#FFF', fontSize: 16, lineHeight: 21,
    paddingHorizontal: 14, paddingVertical: 10,
    marginHorizontal: 12, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    maxHeight: 90,
  },

  styleChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'transparent',
  },
  styleChipActive: { backgroundColor: '#FFFFFF' },
  styleChipTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  styleChipTxtActive: { color: '#000000' },

  colorSwatch: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)',
  },
  colorSwatchActive: { borderColor: '#FFFFFF', borderWidth: 3 },

  bgPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  bgPickerSheet: {
    backgroundColor: '#1C1C1E', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 10, paddingBottom: 14, paddingHorizontal: 16,
  },
  bgPickerHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignSelf: 'center', marginBottom: 14,
  },
  bgPickerTitle: { fontSize: 17, fontWeight: '700', color: '#FFF', marginBottom: 10 },
  bgSectionLabel: {
    fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.8, marginTop: 10, marginBottom: 8,
  },
  bgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bgTile: {
    width: (SCREEN_W - 32 - 10 * 4) / 5,
    height: (SCREEN_W - 32 - 10 * 4) / 5,
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
  },
  bgTileSelected: { borderColor: '#FFF' },
});