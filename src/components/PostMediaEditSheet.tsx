/**
 * PostMediaEditSheet - the edit stage between picking media and posting.
 * Reuses the story engine (MediaCanvas transform + fit, filter with strength,
 * Adjust, trim strip, mute) and returns a non-destructive PostMediaEdit recipe
 * stored on post_media.edit. The original file is never touched.
 */
import { themedSheet } from '../theme/useTheme';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Animated, TextInput, Image, FlatList, KeyboardAvoidingView, PanResponder, Platform, ScrollView, useWindowDimensions, Alert } from 'react-native';
import TierName from './TierName';
import VerifiedBadge from './VerifiedBadge';
import { supabase } from '../services/supabase';
import { useSafeAreaInsets } from './SafeArea';
import { Feather } from '@expo/vector-icons';
import MediaCanvas from './stories/MediaCanvas';
import type { MediaTransform, MediaFit } from '../services/storiesService';
import { STORY_FILTERS, FilterLayer } from './stories/StoryFilters';
import { MiniSlider, AdjustLayer, type StoryAdjust } from './stories/storyPanels';
import TrimStrip from './stories/TrimStrip';
 
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as ImagePicker from 'expo-image-picker';
import PostCaption from './PostCaption';
import { postAspectRatio, postTimeLabel, postTrimWindow, normalizePostCaptions, normalizePostRotation, postRotationParts, applyPostCaptionTiming, type PostCaptionCue } from '../../shared/postMediaEditing';

/** Cover strip: a filmstrip of the trimmed window with a draggable frame
 *  selector, the way Instagram picks a cover. The selector follows the finger
 *  every frame from local state; the recipe is committed at most every 60ms
 *  and once on release, and the frame under the selector is regenerated only
 *  when the finger stops. */
export function CoverStrip({ uri, durationSec, start, end, at, width, onChange }: {
  uri: string; durationSec: number; start: number; end: number; at: number; width: number; onChange: (sec: number) => void;
}) {
  const N = 8;
  const SEL = 46;
  const trackW = Math.max(SEL + 1, width);
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : Math.max(1, end);
  const s = Math.max(0, Math.min(Math.max(0, duration - 0.05), start));
  // An exact end-of-file seek can fail to decode a poster on iPhone.
  const e = Math.max(s, Math.min(duration, end) - 0.05);
  const span = Math.max(0, e - s);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [frame, setFrame] = useState<string | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const liveRef = useRef(at);
  const grab = useRef(0);
  const lastCommit = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRequest = useRef(0);
  // PanResponder is stable during a drag, but its geometry and callback must
  // follow a changed trim window, orientation or selected media item.
  const current = useRef({ s, e, span, trackW, onChange });
  current.current = { s, e, span, trackW, onChange };

  useEffect(() => {
    let alive = true;
    setThumbs([]);
    setFrame(null);
    setLive(null);
    void (async () => {
      const out: string[] = [];
      for (let i = 0; i < N; i++) {
        try {
          const t = s + (i / (N - 1)) * span;
          const th = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.max(0, Math.round(t * 1000)), quality: 0.3 });
          if (!alive) return;
          out.push(th.uri);
        } catch { if (!alive) return; out.push(''); }
        setThumbs([...out]);
      }
    })();
    return () => { alive = false; };
  }, [uri, s, span]);

  useEffect(() => {
    const selected = Math.max(s, Math.min(e, at));
    if (selected !== at) current.current.onChange(selected);
    const request = ++frameRequest.current;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(async () => {
      stopTimer.current = null;
      try {
        const result = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.max(0, Math.round(selected * 1000)), quality: 0.6 });
        if (request === frameRequest.current) setFrame(result.uri);
      } catch { if (request === frameRequest.current) setFrame(null); }
    }, 260);
    return () => {
      ++frameRequest.current;
      if (stopTimer.current) clearTimeout(stopTimer.current);
    };
  }, [uri, s, e, at]);

  const toX = (sec: number) => {
    const g = current.current;
    return g.span > 0 ? ((Math.max(g.s, Math.min(g.e, sec)) - g.s) / g.span) * (g.trackW - SEL) : 0;
  };
  const toSec = (x: number) => {
    const g = current.current;
    return g.s + (Math.max(0, Math.min(g.trackW - SEL, x)) / (g.trackW - SEL)) * g.span;
  };
  const commit = (sec: number, force: boolean) => {
    const now = Date.now();
    if (!force && now - lastCommit.current < 60) return;
    lastCommit.current = now;
    current.current.onChange(Math.max(current.current.s, Math.min(current.current.e, sec)));
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e2, g) => Math.abs(g.dx) > 2,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { grab.current = toX(liveRef.current); setLive(liveRef.current); },
    onPanResponderMove: (_e2, g) => { const v = toSec(grab.current + g.dx); liveRef.current = v; setLive(v); commit(v, false); },
    onPanResponderRelease: () => { commit(liveRef.current, true); setLive(null); },
    onPanResponderTerminate: () => { commit(liveRef.current, true); setLive(null); },
  })).current;
  liveRef.current = Math.max(s, Math.min(e, live ?? at));
  const vx = toX(liveRef.current);

  return (
    <View style={{ width: trackW, marginTop: 12 }}>
      <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Cover</Text>
      <View {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Video cover frame"
        accessibilityValue={{ min: s, max: e, now: liveRef.current, text: `${liveRef.current.toFixed(1)} seconds` }}
        accessibilityActions={[{ name: 'increment', label: 'Next frame' }, { name: 'decrement', label: 'Previous frame' }]}
        onAccessibilityAction={event => commit(liveRef.current + (event.nativeEvent.actionName === 'increment' ? 0.5 : -0.5), true)}
        style={{ width: trackW, height: 52, borderRadius: 10, overflow: 'hidden', backgroundColor: '#12141B' }}>
        <View style={{ flexDirection: 'row', height: 52 }}>
          {thumbs.map((t, i) => t ? <Image key={i} source={{ uri: t }} style={{ width: trackW / N, height: 52 }} resizeMode="cover" /> : <View key={i} style={{ width: trackW / N, height: 52 }} />)}
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: vx, backgroundColor: 'rgba(0,0,0,0.45)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: vx + SEL, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: vx, top: 0, width: SEL, height: 52, borderRadius: 8, borderWidth: 2.5, borderColor: '#FFFFFF', overflow: 'hidden', backgroundColor: '#000' }}>
          {frame ? <Image source={{ uri: frame }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
        </View>
      </View>
    </View>
  );
}

export type PostMediaEdit = {
  aspectRatio?: number; aspect?: 'original' | 'square' | 'portrait' | 'landscape';
  captions?: PostCaptionCue[];
  /** A local draft only. Publishing uploads it and removes this field. */
  coverLocalUri?: string | null;
  rotation?: number; flipX?: boolean;
  soundtrack?: import("../../shared/soundtrack").SoundtrackSelection|null;
  scale?: number; translateNX?: number; translateNY?: number; fit?: 'cover' | 'contain';
  filterId?: string | null; filterAmt?: number; adjust?: StoryAdjust | null;
  trimStart?: number | null; trimEnd?: number | null; muted?: boolean;
  /** Playback speed as a creative effect, e.g. 0.5, 1.5, 2, 3. 1 or unset means normal speed. */
  speed?: number | null;
  /** Video cover: chosen frame (seconds) and the uploaded poster image. */
  coverAt?: number | null; coverUrl?: string | null;
  /** Tagged people, anchored by normalised position; saved to post_media_tags on publish, not kept in the recipe. */
  tags?: MediaTagDraft[] | null;
};
export type MediaTagDraft = { user_id: string; nx: number; ny: number; full_name?: string | null; username?: string | null; avatar_url?: string | null };

export default function PostMediaEditSheet({ visible, uri, mediaType, width, height, durationSec, initial, itemIndex = 0, itemCount = 1, onDone, onCancel }: {
  visible: boolean; uri: string | null; mediaType: 'image' | 'video'; width?: number; height?: number; durationSec?: number;
  initial?: PostMediaEdit | null; itemIndex?: number; itemCount?: number; onDone: (edit: PostMediaEdit, applyLookToAll?: boolean) => void; onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [edit, setEdit] = useState<PostMediaEdit>(initial || {});
  const [mode, setMode] = useState<'crop' | 'filter' | 'adjust' | 'trim' | 'captions' | 'cover'>(mediaType === 'video' ? 'trim' : 'crop');
  const [comparing, setComparing] = useState(false);
  const [applyLookToAll, setApplyLookToAll] = useState(false);
  const [sliderDragging, setSliderDragging] = useState(false);
  const [adjustKey, setAdjustKey] = useState<keyof StoryAdjust>('bri');
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [selectedCaption, setSelectedCaption] = useState(0);
  const [captionTimingDrafts,setCaptionTimingDrafts]=useState<Record<string,{start?:string;end?:string}>>({});
  const captionTimingDraftsRef=useRef<Record<string,{start?:string;end?:string}>>({});
  const [player, setPlayer] = useState<any>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  useEffect(() => { if (player) { try { player.playbackRate = edit.speed || 1; } catch {} } }, [player, edit.speed]);
  // Tag people: arm the tool, tap the picture where the person is, pick them.
  const [tagMode, setTagMode] = useState(false);
  const [tagAt, setTagAt] = useState<{ nx: number; ny: number } | null>(null);
  const [tagQuery, setTagQuery] = useState('');
  const [tagResults, setTagResults] = useState<any[]>([]);
  useEffect(() => {
    if (!tagAt) return;
    const q = tagQuery.trim().replace(/^@/, '');
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const base = supabase.from('profiles').select('id, full_name, username, avatar_url, is_verified, verified_tier').limit(20);
        const { data } = q ? await base.or(`username.ilike.${q}%,full_name.ilike.%${q}%`) : await base.order('last_seen', { ascending: false });
        if (!dead) setTagResults((data ?? []) as any[]);
      } catch { if (!dead) setTagResults([]); }
    }, 160);
    return () => { dead = true; clearTimeout(t); };
  }, [tagQuery, tagAt]);
  const addTag = (p: any) => {
    if (!tagAt) return;
    setEdit(ed => ({ ...ed, tags: [ ...(ed.tags || []).filter(t => t.user_id !== p.id), { user_id: p.id, nx: tagAt.nx, ny: tagAt.ny, full_name: p.full_name, username: p.username, avatar_url: p.avatar_url } ] }));
    setTagAt(null); setTagQuery(''); setTagResults([]);
  };
  const removeTag = (uid: string) => setEdit(ed => ({ ...ed, tags: (ed.tags || []).filter(t => t.user_id !== uid) }));
  const [dur, setDur] = useState(durationSec || 0);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  React.useEffect(() => { if (visible) { setEdit(initial?.aspectRatio||initial?.aspect?{...initial}:{ aspectRatio: 4 / 5, ...initial }); setDur(durationSec || 0); setMode(mediaType === 'video' ? 'trim' : 'crop'); setTagMode(false); setSelectedCaption(0); setComparing(false); setApplyLookToAll(false);captionTimingDraftsRef.current={};setCaptionTimingDrafts({}); } }, [visible, uri]);
  useEffect(() => {
    if (!player || !visible) return;
    try { player.timeUpdateEventInterval = .1; } catch {}
    const time = player.addListener?.('timeUpdate', (event: any) => { setClock(event.currentTime ?? player.currentTime ?? 0); if (player.duration > 0) setDur(player.duration); });
    const state = player.addListener?.('playingChange', (event: any) => setPlaying(!!event.isPlaying));
    return () => { time?.remove?.(); state?.remove?.(); try { player.pause(); } catch {} };
  }, [player, visible]);
  useEffect(() => {
    if ((mode !== 'cover' && mode !== 'filter') || mediaType !== 'video' || !uri) return;
    let alive = true;
    try { player?.pause(); } catch {}
    if (edit.coverLocalUri) { setCoverPreview(edit.coverLocalUri); return; }
    const range = postTrimWindow(dur || durationSec || 15, edit.trimStart, edit.trimEnd);
    const at = Math.min(range.coverEnd, Math.max(range.start, edit.coverAt ?? range.start));
    setCoverPreview(null);
    VideoThumbnails.getThumbnailAsync(uri, {time: Math.round(at * 1000), quality: .7}).then(result => { if (alive) setCoverPreview(result.uri); }).catch(() => {});
    return () => { alive = false; };
  }, [mode, uri, edit.coverAt, edit.coverLocalUri, edit.trimStart, edit.trimEnd, dur, player]);
  const chooseCover = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({mediaTypes: ['images'], quality: 1});
      if (!result.canceled && result.assets[0]?.uri) setEdit(value => ({...value, coverLocalUri: result.assets[0].uri}));
    } catch { Alert.alert('Cover unavailable', 'That photo could not be opened. Please choose another photo.'); }
  };
  const ratio = postAspectRatio(edit, width, height);
  // Keep the actual chosen frame ratio on short screens too. Shrink the
  // stage, never change the crop merely to fit the controls underneath it.
  const previewRoom = Math.max(180, windowHeight - insets.top - Math.max(insets.bottom, 14) - 325);
  const canvasW = Math.min(windowWidth - 32, 680, previewRoom * ratio);
  const canvasH = canvasW / ratio;
  const panelW = Math.min(windowWidth - 32, 680);
  const tx: MediaTransform = { scale: edit.scale ?? 1, translateNX: edit.translateNX ?? 0, translateNY: edit.translateNY ?? 0 } as MediaTransform;
  const fit: MediaFit = (edit.fit || 'cover') as MediaFit;
  const setTx = useCallback((t: MediaTransform) => setEdit(e => ({ ...e, scale: t.scale, translateNX: t.translateNX, translateNY: t.translateNY })), []);
  const isVideo = mediaType === 'video';
  const trimEnd = edit.trimEnd ?? (dur > 0 ? dur : null);
  const range = postTrimWindow(dur || 15, edit.trimStart, trimEnd);
  const captions = edit.captions ?? [];
  const cue = captions[selectedCaption];
  const updateCue = (patch: Partial<PostCaptionCue>) => setEdit(value => ({...value, captions: (value.captions ?? []).map((c, i) => i === selectedCaption ? {...c, ...patch} : c)}));
  const addCaption = () => {
    if (captions.length >= 8) return;
    setSelectedCaption(captions.length);
    setEdit(value => ({...value, captions: [...(value.captions ?? []), {id: `caption-${Date.now()}`, text: '', start: range.start, end: range.end, style: 'clean', position: 'bottom'}]}));
    try { player?.pause(); } catch {}
  };
  const selectMode = (next: typeof mode) => { setMode(next); setTagMode(false); if (next === 'captions' && !captions.length) addCaption(); };
  const adjustments: {key:keyof StoryAdjust;label:string;icon:any;min?:number}[] = [
    {key:'bri',label:'Light',icon:'sun'}, {key:'con',label:'Contrast',icon:'circle'}, {key:'warm',label:'Warmth',icon:'thermometer'}, {key:'sat',label:'Color',icon:'droplet'}, {key:'hi',label:'Highlights',icon:'sunrise'}, {key:'sh',label:'Shadows',icon:'moon'}, {key:'tint',label:'Tint',icon:'aperture'}, {key:'fade',label:'Fade',icon:'cloud',min:0}, {key:'grain',label:'Grain',icon:'grid',min:0}, {key:'vig',label:'Vignette',icon:'disc',min:0},
  ];
  const activeAdjustment = adjustments.find(a => a.key === adjustKey)!;
  const rotationParts=postRotationParts(edit.rotation);
  const draftCaptionTime=(id:string,key:'start'|'end',text:string)=>{const next={...captionTimingDraftsRef.current,[id]:{...captionTimingDraftsRef.current[id],[key]:text}};captionTimingDraftsRef.current=next;setCaptionTimingDrafts(next);};
  const commitCaptionTime=(caption:PostCaptionCue)=>{const next=applyPostCaptionTiming(caption,captionTimingDraftsRef.current[caption.id],range.start,range.end);setEdit(previous=>({...previous,captions:(previous.captions??[]).map(c=>c.id===caption.id?next:c)}));const drafts={...captionTimingDraftsRef.current};delete drafts[caption.id];captionTimingDraftsRef.current=drafts;setCaptionTimingDrafts(drafts);};
  const modes: {id: typeof mode; label:string; icon:any}[] = isVideo
    ? [{id:'trim',label:'Trim',icon:'scissors'},{id:'crop',label:'Crop',icon:'crop'},{id:'captions',label:'Captions',icon:'type'},{id:'cover',label:'Cover',icon:'image'},{id:'filter',label:'Filters',icon:'aperture'},{id:'adjust',label:'Adjust',icon:'sliders'}]
    : [{id:'crop',label:'Crop',icon:'crop'},{id:'filter',label:'Filters',icon:'aperture'},{id:'adjust',label:'Adjust',icon:'sliders'}];
  const title = modes.find(tool => tool.id === mode)?.label ?? 'Edit';
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={[st.root, { paddingTop: insets.top }]}>
        <View style={st.top}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel media editing" onPress={onCancel} style={st.topBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="x" size={22} color="#FFF" /></TouchableOpacity>
          <Text style={st.title}>{title}{itemCount > 1 ? ` · ${itemIndex + 1} of ${itemCount}` : ''}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Apply media edits" onPress={() => { try { player?.pause(); } catch {} onDone({...edit, captions: normalizePostCaptions((edit.captions??[]).map(c=>applyPostCaptionTiming(c,captionTimingDraftsRef.current[c.id],range.start,range.end)), dur || 600)}, applyLookToAll); }} style={st.done} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.doneTxt}>{mode === 'crop' ? 'Apply' : 'Done'}</Text></TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} scrollEnabled={!sliderDragging} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingTop: 12, paddingBottom: 20 }} keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={{ width: canvasW, height: canvasH, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' }}>
            <MediaCanvas localUri={uri} mediaType={mediaType} uploadState="idle" onRetry={() => {}} onLayout={() => {}} scaleAnim={scaleAnim} opacityAnim={opacityAnim}
              imageW={width} imageH={height} mediaFit={fit} postRotation={comparing ? 0 : edit.rotation} postFlipX={!comparing && edit.flipX} mediaTransform={comparing ? {fit,scale:1,translateNX:0,translateNY:0} : tx} onTransformChange={setTx}
              onFitToggle={() => setEdit(e => ({ ...e, fit: (e.fit || 'cover') === 'cover' ? 'contain' : 'cover' }))} interactive={mode === 'crop' && !comparing}
              videoMuted={!!edit.muted} videoVolume={edit.muted ? 0 : 1} trimStart={edit.trimStart ?? null} trimEnd={edit.trimEnd ?? null} onVideoPlayer={setPlayer}>
              {!comparing && <><FilterLayer filterId={edit.filterId || null} amt={edit.filterAmt ?? 100} /><AdjustLayer adjust={edit.adjust || null} /></>}
            </MediaCanvas>
            {mode === 'cover' && coverPreview ? <View pointerEvents="none" style={StyleSheet.absoluteFill}><Image source={{uri:coverPreview}} style={[StyleSheet.absoluteFill, {transform:[{translateX:(edit.translateNX ?? 0)*canvasW},{translateY:(edit.translateNY ?? 0)*canvasH},{scale:edit.scale ?? 1},{rotate:`${edit.rotation ?? 0}deg`},{scaleX:edit.flipX?-1:1}]}]} resizeMode={fit === 'contain' ? 'contain' : 'cover'} /><FilterLayer filterId={edit.filterId || null} amt={edit.filterAmt ?? 100} /><AdjustLayer adjust={edit.adjust} /></View> : null}
            {mode !== 'cover' && !comparing ? <PostCaption captions={captions} time={clock} preview={mode === 'captions' ? cue : undefined} /> : null}
            {(mode === 'crop' || mode === 'cover') && !tagMode ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, {borderColor:'rgba(255,255,255,.8)',borderWidth:1, margin:8, borderRadius:4}]}>
              {mode === 'crop' ? <>{[1,2].map(n => <React.Fragment key={n}><View style={{position:'absolute',left:0,right:0,top:`${n*100/3}%`,height:StyleSheet.hairlineWidth,backgroundColor:'rgba(255,255,255,.6)'}} /><View style={{position:'absolute',top:0,bottom:0,left:`${n*100/3}%`,width:StyleSheet.hairlineWidth,backgroundColor:'rgba(255,255,255,.6)'}} /></React.Fragment>)}</> : null}
              {(['tl','tr','bl','br'] as const).map(corner => <View key={corner} style={{position:'absolute',width:20,height:20,borderColor:'#FFF',borderTopWidth:corner.startsWith('t')?4:0,borderBottomWidth:corner.startsWith('b')?4:0,borderLeftWidth:corner.endsWith('l')?4:0,borderRightWidth:corner.endsWith('r')?4:0,top:corner.startsWith('t')?-2:undefined,bottom:corner.startsWith('b')?-2:undefined,left:corner.endsWith('l')?-2:undefined,right:corner.endsWith('r')?-2:undefined,borderRadius:3}} />)}
            </View> : null}
            {(mode === 'filter' || mode === 'adjust') ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Hold to compare with original" onPressIn={() => setComparing(true)} onPressOut={() => setComparing(false)} style={st.compare}><Feather name="eye" size={16} color="#FFF" /><Text style={st.compareText}>Hold to compare</Text></TouchableOpacity> : null}
            {tagMode ? (
              <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill}
                onPress={(ev) => { const { locationX, locationY } = ev.nativeEvent; setTagAt({ nx: Math.max(0.02, Math.min(0.98, locationX / canvasW)), ny: Math.max(0.02, Math.min(0.98, locationY / canvasH)) }); }}>
                <View pointerEvents="none" style={{ position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: '#FFF', fontSize: 12.5, fontWeight: '700' }}>Tap where the person is</Text></View>
              </TouchableOpacity>
            ) : null}
            {(() => {
              // Placed tags while editing: the same pill as the post (avatar, tier name,
              // seal) plus a remove x, laid out so they never overlap or run off the
              // picture; the pearl dot stays exactly where you tapped.
              const PILL = 32, GAP = 6; const placed: { t: any; dx: number; dy: number; x: number; y: number; w: number }[] = [];
              [...(edit.tags || [])].sort((a, b) => a.ny - b.ny || a.nx - b.nx).forEach(t => {
                const dx = t.nx * canvasW, dy = t.ny * canvasH; const w = Math.min(canvasW * 0.75, 84 + (t.full_name || t.username || 'Member').length * 7.4);
                let x = dx - 10; if (x + w > canvasW - 6) x = canvasW - 6 - w; if (x < 6) x = 6;
                let y = dy + 10; if (y + PILL > canvasH - 6) y = dy - 10 - PILL;
                for (let g = 0; g < 12; g++) { const hit = placed.find(p => !(x + w < p.x || p.x + p.w < x) && Math.abs(y - p.y) < PILL + GAP); if (!hit) break; y = hit.y + PILL + GAP; if (y + PILL > canvasH - 6) y = Math.max(6, hit.y - PILL - GAP); }
                placed.push({ t, dx, dy, x, y, w });
              });
              return placed.map(({ t, dx, dy, x, y, w }) => (
                <React.Fragment key={t.user_id}>
                  {Math.abs((y - 10) - dy) > 14 ? <View pointerEvents="none" style={{ position: 'absolute', left: dx - 1, top: Math.min(dy, y + PILL / 2), width: 2, height: Math.abs((y + PILL / 2) - dy), backgroundColor: 'rgba(255,255,255,0.55)' }} /> : null}
                  <View pointerEvents="none" style={{ position: 'absolute', left: dx - 5, top: dy - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#C9BFB0', borderWidth: 1.5, borderColor: '#FFF' }} />
                  <View style={{ position: 'absolute', left: x, top: y, width: w, height: PILL, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(11,30,61,0.9)', borderRadius: 16, paddingLeft: 4, paddingRight: 6 }}>
                    {t.avatar_url ? <Image source={{ uri: t.avatar_url }} style={{ width: 24, height: 24, borderRadius: 12 }} /> : <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#C9BFB0' }} />}
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 6, minWidth: 0 }}>
                      <TierName userId={t.user_id} baseStyle={{ color: '#FFF', fontSize: 12.5, fontWeight: '700', flexShrink: 1 }} text={t.full_name || t.username || 'Member'} />
                      <VerifiedBadge userId={t.user_id} size={12} />
                    </View>
                    <TouchableOpacity onPress={() => removeTag(t.user_id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)', marginLeft: 4 }}><Feather name="x" size={13} color="#FFF" /></TouchableOpacity>
                  </View>
                </React.Fragment>
              ));
            })()}
          </View>
          <View style={{width:panelW, paddingTop:16}}>
            {mode === 'crop' ? <>
              <View style={st.ratioRow}>{[{label:'Original',ratio:width && height ? Math.max(.25,Math.min(4,width/height)) : 4/5},{label:'1:1',ratio:1},{label:'4:5',ratio:4/5},{label:'16:9',ratio:16/9}].map(option => {const selected=option.label==='Original'?edit.aspect==='original':edit.aspect!=='original'&&Math.abs(ratio-option.ratio)<.001;return <TouchableOpacity key={option.label} accessibilityRole="button" accessibilityLabel={`${option.label} crop`} accessibilityState={{selected}} onPress={() => setEdit(e => ({...e,aspectRatio:option.ratio,aspect:option.label==='Original'?'original':undefined,scale:1,translateNX:0,translateNY:0}))} style={[st.ratioOption,selected && st.selected]}><View style={{width:option.ratio>=1?28:22,height:option.ratio>=1?28/option.ratio:28,borderWidth:1.5,borderColor:'#F5F1E9',borderRadius:4}} /><Text style={st.smallLabel}>{option.label}</Text></TouchableOpacity>;})}</View>
              <EditorSlider label="Straighten" value={rotationParts.straighten} min={-45} max={45} width={panelW-32} onChange={straighten => setEdit(e=>({...e,rotation:normalizePostRotation(postRotationParts(e.rotation).base+straighten)}))} onDrag={setSliderDragging} unit="°" />
              <View style={st.actionRow}><TouchableOpacity accessibilityLabel="Rotate 90 degrees" style={st.action} onPress={()=>setEdit(e=>({...e,rotation:normalizePostRotation((e.rotation||0)+90)}))}><Feather name="rotate-cw" size={19} color="#FFF"/><Text style={st.smallLabel}>Rotate</Text></TouchableOpacity><TouchableOpacity accessibilityLabel="Flip horizontally" style={st.action} onPress={()=>setEdit(e=>({...e,flipX:!e.flipX}))}><Feather name="repeat" size={19} color="#FFF"/><Text style={st.smallLabel}>Flip</Text></TouchableOpacity><View style={st.segment}>{(['contain','cover'] as const).map(v=><TouchableOpacity key={v} accessibilityRole="button" accessibilityLabel={v==='contain'?'Fit full image':'Fill crop frame'} accessibilityState={{selected:fit===v}} style={[st.segmentButton,fit===v&&st.segmentSelected]} onPress={()=>setEdit(e=>({...e,fit:v}))}><Text style={[st.smallLabel,fit===v&&{color:'#0B1E3D'}]}>{v==='contain'?'Fit':'Fill'}</Text></TouchableOpacity>)}</View></View>
              {!isVideo ? <TouchableOpacity style={st.rowButton} onPress={()=>setTagMode(m=>!m)}><Feather name="user-plus" size={19} color="#E9DCC7"/><Text style={st.rowButtonText}>{tagMode?'Done tagging':'Tag people'}</Text><Text style={st.mutedLabel}>{edit.tags?.length||''}</Text><Feather name="chevron-right" size={17} color="#99A0AB"/></TouchableOpacity>:null}
              <Text style={st.hint}>Pinch to zoom. Drag to position your photo inside the frame.</Text>
            </> : null}
            {mode === 'filter' ? <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:12,paddingVertical:4}}>{[{id:null,label:'Original'},...STORY_FILTERS].map(filter=><TouchableOpacity key={filter.id??'original'} accessibilityRole="button" accessibilityLabel={`${filter.label} filter`} accessibilityState={{selected:(edit.filterId??null)===filter.id}} onPress={()=>setEdit(e=>({...e,filterId:filter.id}))} style={{width:76,alignItems:'center',gap:7}}><View style={[{width:76,height:88,borderRadius:12,overflow:'hidden',borderWidth:2,borderColor:'transparent'},(edit.filterId??null)===filter.id&&{borderColor:'#E8D4AE'}]}>{uri?<Image source={{uri:mediaType==='video'?(coverPreview??edit.coverLocalUri??uri):uri}} style={StyleSheet.absoluteFill} resizeMode="cover"/>:null}<FilterLayer filterId={filter.id}/></View><Text numberOfLines={1} style={st.smallLabel}>{filter.label}</Text></TouchableOpacity>)}</ScrollView>
              <EditorSlider label="Strength" value={edit.filterAmt??100} min={0} max={100} width={panelW-32} onChange={filterAmt=>setEdit(e=>({...e,filterAmt}))} onDrag={setSliderDragging}/>
            </>:null}
            {mode === 'adjust' ? <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:14}}>{adjustments.map(a=><TouchableOpacity key={a.key} accessibilityRole="button" accessibilityLabel={a.label} accessibilityState={{selected:adjustKey===a.key}} style={st.tool} onPress={()=>setAdjustKey(a.key)}><View style={[st.toolIcon,adjustKey===a.key&&st.toolIconOn]}><Feather name={a.icon} size={22} color={adjustKey===a.key?'#0B1E3D':'#FFF'}/></View><Text style={st.toolLabel}>{a.label}</Text></TouchableOpacity>)}</ScrollView>
              <EditorSlider label={activeAdjustment.label} value={edit.adjust?.[adjustKey]??0} min={activeAdjustment.min??-100} max={100} width={panelW-32} onChange={value=>setEdit(e=>({...e,adjust:{...e.adjust,[adjustKey]:value}}))} onDrag={setSliderDragging}/>
              <TouchableOpacity style={st.reset} onPress={()=>setEdit(e=>({...e,adjust:null}))}><Feather name="rotate-ccw" size={17} color="#FFF"/><Text style={st.smallLabel}>Reset adjustments</Text></TouchableOpacity>
            </>:null}
            {mode === 'trim' && uri ? <>
              <View style={st.playRow}><TouchableOpacity accessibilityRole="button" accessibilityLabel={playing?'Pause video':'Play video'} style={st.playButton} onPress={()=>{try{playing?player?.pause():player?.play();}catch{}}}><Feather name={playing?'pause':'play'} size={22} color="#FFF"/></TouchableOpacity><Text style={st.smallLabel}>{postTimeLabel(clock)} / {postTimeLabel(dur)}</Text></View>
              <TrimStrip uri={uri} durationSec={dur || 15} start={range.start} end={range.end} onChange={(start,end)=>setEdit(e=>({...e,trimStart:Math.round(start*100)/100,trimEnd:Math.round(end*100)/100,coverAt:Math.max(start,Math.min(end-.05,e.coverAt??start))}))} onDuration={setDur} player={player} width={panelW}/>
              <View style={st.timeLabels}><Text style={st.mutedLabel}>Start {postTimeLabel(range.start)}</Text><Text style={st.smallLabel}>{range.duration.toFixed(1)} sec selected</Text><Text style={st.mutedLabel}>End {postTimeLabel(range.end)}</Text></View>
              <TouchableOpacity style={st.rowButton} onPress={()=>setEdit(e=>({...e,muted:!e.muted}))}><Feather name={edit.muted?'volume-x':'volume-2'} size={19} color="#E9DCC7"/><Text style={st.rowButtonText}>Original audio</Text><Text style={st.mutedLabel}>{edit.muted?'Muted':'On'}</Text></TouchableOpacity>
              <TouchableOpacity style={st.rowButton} onPress={()=>setSpeedOpen(v=>!v)}><Feather name="fast-forward" size={19} color="#E9DCC7"/><Text style={st.rowButtonText}>Speed</Text><Text style={st.mutedLabel}>{edit.speed||1}×</Text><Feather name="chevron-right" size={17} color="#99A0AB"/></TouchableOpacity>
              {speedOpen ? <View style={st.speedRow}>{[.5,1,1.5,2,3].map(speed=><TouchableOpacity key={speed} style={[st.speedChoice,(edit.speed||1)===speed&&st.selected]} onPress={()=>setEdit(e=>({...e,speed}))}><Text style={st.smallLabel}>{speed}×</Text></TouchableOpacity>)}</View>:null}
            </>:null}
            {mode === 'cover' && uri ? <>
              <Text style={[st.mutedLabel,{textAlign:'center',marginBottom:12}]}>Feed preview · {Math.abs(ratio-.8)<.001?'4:5':Math.abs(ratio-1)<.001?'1:1':Math.abs(ratio-16/9)<.001?'16:9':'Original'}</Text>
              {!edit.coverLocalUri ? <CoverStrip uri={uri} durationSec={dur||15} start={range.start} end={range.end} at={edit.coverAt??range.start} width={panelW} onChange={coverAt=>setEdit(e=>({...e,coverAt}))}/>:null}
              <View style={st.coverChoices}><TouchableOpacity style={[st.coverChoice,!edit.coverLocalUri&&st.selected]} onPress={()=>setEdit(e=>({...e,coverLocalUri:null}))}><Feather name="image" size={23} color="#F6F2EB"/><Text style={st.smallLabel}>Video frame</Text><Feather name={!edit.coverLocalUri?'check-circle':'circle'} size={17} color="#E6D2AB"/></TouchableOpacity><TouchableOpacity style={[st.coverChoice,!!edit.coverLocalUri&&st.selected]} onPress={chooseCover}><Feather name="upload" size={23} color="#F6F2EB"/><Text style={st.smallLabel}>Upload cover</Text><Feather name={edit.coverLocalUri?'check-circle':'circle'} size={17} color="#E6D2AB"/></TouchableOpacity></View>
              <TouchableOpacity style={st.rowButton} onPress={()=>selectMode('crop')}><Feather name="crop" size={20} color="#E9DCC7"/><Text style={st.rowButtonText}>Adjust crop</Text><Feather name="chevron-right" size={17} color="#99A0AB"/></TouchableOpacity>
            </>:null}
            {mode === 'captions' ? <>
              {cue ? <><Text style={st.sectionLabel}>Edit text</Text><TextInput multiline maxLength={160} value={cue.text} onChangeText={text=>updateCue({text})} placeholder="Add a caption to your video" placeholderTextColor="#8E96A4" style={st.captionInput}/><Text style={[st.mutedLabel,{textAlign:'right'}]}>{cue.text.length}/160</Text><View style={st.speedRow}>{(['clean','bold','highlight'] as const).map(style=><TouchableOpacity key={style} style={[st.captionStyle,cue.style===style&&st.selected]} onPress={()=>updateCue({style})}><Text style={{color:'#FFF',fontSize:23,fontFamily:style==='clean'?'Georgia':undefined,fontWeight:style==='bold'?'800':'400'}}>Aa</Text><Text style={st.smallLabel}>{style[0].toUpperCase()+style.slice(1)}</Text></TouchableOpacity>)}</View><View style={st.timeFields}><View style={{flex:1}}><Text style={st.mutedLabel}>Start (seconds)</Text><TextInput accessibilityLabel="Caption start in seconds" keyboardType="decimal-pad" value={captionTimingDrafts[cue.id]?.start??String(cue.start)} onChangeText={text=>draftCaptionTime(cue.id,'start',text)} onBlur={()=>commitCaptionTime(cue)} style={st.timeInput}/></View><View style={{flex:1}}><Text style={st.mutedLabel}>End (seconds)</Text><TextInput accessibilityLabel="Caption end in seconds" keyboardType="decimal-pad" value={captionTimingDrafts[cue.id]?.end??String(cue.end)} onChangeText={text=>draftCaptionTime(cue.id,'end',text)} onBlur={()=>commitCaptionTime(cue)} style={st.timeInput}/></View></View><View style={st.actionRow}>{(['top','middle','bottom'] as const).map(position=><TouchableOpacity key={position} style={[st.speedChoice,cue.position===position&&st.selected]} onPress={()=>updateCue({position})}><Text style={st.smallLabel}>{position[0].toUpperCase()+position.slice(1)}</Text></TouchableOpacity>)}</View></>:null}
              {captions.map((caption,i)=><TouchableOpacity key={caption.id} style={[st.captionRow,i===selectedCaption&&st.selected]} onPress={()=>{setSelectedCaption(i);try{player.pause();player.currentTime=caption.start;}catch{}}}><Text style={st.mutedLabel}>{postTimeLabel(caption.start)}</Text><Text numberOfLines={1} style={[st.smallLabel,{flex:1}]}>{caption.text||'New caption'}</Text><TouchableOpacity accessibilityLabel={`Remove caption ${i+1}`} style={st.removeCaption} onPress={()=>{setEdit(e=>({...e,captions:(e.captions??[]).filter((_,x)=>x!==i)}));setSelectedCaption(0);}}><Feather name="x" size={17} color="#FFF"/></TouchableOpacity></TouchableOpacity>)}
              {captions.length<8?<TouchableOpacity style={st.rowButton} onPress={addCaption}><Feather name="plus" size={19} color="#E9DCC7"/><Text style={st.rowButtonText}>Add another caption</Text></TouchableOpacity>:null}
            </>:null}
            {itemCount > 1 && (mode === 'filter' || mode === 'adjust') ? <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel="Apply this look to all media" accessibilityState={{checked:applyLookToAll}} style={st.rowButton} onPress={()=>setApplyLookToAll(value=>!value)}><Feather name={applyLookToAll?'check-square':'square'} size={22} color="#F2D5C2"/><Text style={st.rowButtonText}>Apply this look to all media</Text><Text style={st.mutedLabel}>{itemCount} items</Text></TouchableOpacity> : null}
            {mode === 'crop' || mode === 'filter' ? <TouchableOpacity style={st.reset} onPress={()=>setEdit(e=>({...e, ...(mode==='crop'?{scale:1,translateNX:0,translateNY:0,rotation:0,flipX:false,fit:'cover' as const,aspectRatio:4/5,aspect:undefined}:{filterId:null,filterAmt:100})}))}><Feather name="rotate-ccw" size={17} color="#FFF"/><Text style={st.smallLabel}>Reset {mode==='crop'?'crop':'filter'}</Text></TouchableOpacity>:null}
          </View>
        </ScrollView>
        <View style={{paddingBottom:Math.max(insets.bottom,12),borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#29313C'}}><ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false} contentContainerStyle={[st.tools,{minWidth:windowWidth,justifyContent:'space-evenly'}]}>{modes.map(tool=><TouchableOpacity accessibilityRole="button" accessibilityLabel={tool.label} accessibilityState={{selected:mode===tool.id}} key={tool.id} style={st.tool} onPress={()=>selectMode(tool.id)}><View style={[st.toolIcon,mode===tool.id&&st.toolIconOn]}><Feather name={tool.icon} size={22} color={mode===tool.id?'#10213E':'#FFFFFF'}/></View><Text style={[st.toolLabel,mode===tool.id&&{color:'#E9DCC7'}]}>{tool.label}</Text></TouchableOpacity>)}</ScrollView></View>
        <Modal visible={!!tagAt} transparent animationType="fade" onRequestClose={() => setTagAt(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setTagAt(null)} />
            <View style={{ backgroundColor: '#FFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12) + 8, maxHeight: '62%' }}>
              <View style={{ alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(11,30,61,0.18)', marginBottom: 10 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, backgroundColor: 'rgba(11,30,61,0.06)', borderRadius: 12, paddingHorizontal: 12, height: 42 }}>
                <Feather name="search" size={16} color="rgba(11,30,61,0.55)" />
                <TextInput value={tagQuery} onChangeText={setTagQuery} placeholder="Who is this?" placeholderTextColor="rgba(11,30,61,0.45)" autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={{ flex: 1, fontSize: 15, color: '#0B1E3D' }} />
                <TouchableOpacity onPress={() => setTagAt(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={{ color: '#0B1E3D', fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
              </View>
              <FlatList data={tagResults} keyExtractor={(p: any) => p.id} keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag" style={{ marginTop: 6 }}
                ListEmptyComponent={<Text style={{ textAlign: 'center', color: 'rgba(11,30,61,0.5)', paddingVertical: 18, fontSize: 13 }}>{tagQuery.trim() ? 'No one matches that yet' : 'Type a name or handle'}</Text>}
                renderItem={({ item: p }: any) => (
                  <TouchableOpacity onPress={() => addTag(p)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
                    {p.avatar_url ? <Image source={{ uri: p.avatar_url }} style={{ width: 38, height: 38, borderRadius: 19 }} /> : <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(11,30,61,0.08)' }} />}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <TierName userId={p.id} tier={p.is_verified ? (p.verified_tier ?? null) : null} baseStyle={{ fontSize: 14.5, fontWeight: '700', color: '#0B1E3D', flexShrink: 1 }} text={p.full_name || p.username} />
                        {p.is_verified ? <VerifiedBadge tier={p.verified_tier ?? undefined} size={14} /> : null}
                      </View>
                      {p.username ? <Text style={{ fontSize: 12, color: 'rgba(11,30,61,0.55)' }}>@{p.username}</Text> : null}
                    </View>
                  </TouchableOpacity>
                )} />
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function EditorSlider({label,value,min,max,width,onChange,onDrag,unit=''}:{label:string;value:number;min:number;max:number;width:number;onChange:(v:number)=>void;onDrag:(v:boolean)=>void;unit?:string}) {
  return <View style={{paddingHorizontal:16,paddingVertical:14,alignItems:'center',gap:16}} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{min,max,now:value,text:`${value}${unit}`}} accessibilityActions={[{name:'increment'},{name:'decrement'}]} onAccessibilityAction={e=>onChange(Math.max(min,Math.min(max,value+(e.nativeEvent.actionName==='increment'?1:-1))))}>
    <Text style={{color:'#F5F1E9',fontSize:14,fontWeight:'600'}}>{label}  {value>0?'+':''}{Math.round(value)}{unit}</Text>
    <MiniSlider value={value} min={min} max={max} width={width} onChange={onChange} onDragStateChange={onDrag}/>
  </View>;
}

const st = themedSheet(() => ({
  root: { flex: 1, backgroundColor: '#0B1118' },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 58, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#29313C' },
  topBtn: { width: 44, height: 44, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  title: { flex: 1, textAlign: 'center', color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  done: { minHeight: 44, justifyContent: 'center', backgroundColor: '#E8D7BC', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8 },
  doneTxt: { color: '#0B1E3D', fontSize: 14, fontWeight: '800' },
  tools: { flexDirection: 'row', gap: 8, paddingTop: 12, paddingHorizontal: 12 },
  tool: { alignItems: 'center', width: 64, minHeight: 76 },
  toolIcon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: '#35404D', backgroundColor: '#161E28', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  toolIconOn: { backgroundColor: '#E8D7BC' },

  selected: { borderColor: '#E8D4AE', borderWidth: 2, backgroundColor: '#18222D' },
  ratioRow: { flexDirection:'row',justifyContent:'space-between',gap:8 },
  ratioOption: { flex:1,minHeight:78,borderWidth:2,borderColor:'transparent',borderRadius:13,alignItems:'center',justifyContent:'center',gap:9 },
  smallLabel: { color:'#F6F2EC',fontSize:12.5,fontWeight:'600' },
  mutedLabel: { color:'#9FA8B6',fontSize:12 },
  actionRow: { flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:12 },
  action: { flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,minHeight:44,paddingHorizontal:6 },
  segment: { flexDirection:'row',backgroundColor:'#161E28',borderRadius:12,borderWidth:1,borderColor:'#35404D',padding:3 },
  segmentButton: { minWidth:58,minHeight:40,alignItems:'center',justifyContent:'center',borderRadius:9 },
  segmentSelected: { backgroundColor:'#E8D7BC' },
  hint: { color:'#8E98A6',fontSize:11.5,textAlign:'center',lineHeight:17,marginTop:14 },
  compare: { position:'absolute',bottom:14,alignSelf:'center',backgroundColor:'rgba(0,0,0,.68)',borderRadius:22,paddingHorizontal:15,minHeight:44,flexDirection:'row',alignItems:'center',gap:8,zIndex:6 },
  compareText: { color:'#FFF',fontSize:12,fontWeight:'600' },
  rowButton: { flexDirection:'row',alignItems:'center',gap:12,minHeight:56,paddingHorizontal:14,paddingVertical:10,marginTop:10,backgroundColor:'#141D27',borderWidth:1,borderColor:'#323D4B',borderRadius:14 },
  rowButtonText: { flex:1,color:'#F6F2EC',fontSize:14,fontWeight:'600' },
  reset: { minHeight:48,marginTop:16,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#35404D',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8 },
  playRow: { flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:10 },
  playButton: { width:44,height:44,alignItems:'center',justifyContent:'center' },
  timeLabels: { flexDirection:'row',justifyContent:'space-between',gap:8,marginTop:10,marginBottom:4 },
  speedRow: { flexDirection:'row',gap:8,marginTop:12 },
  speedChoice: { flex:1,minHeight:44,paddingHorizontal:10,borderWidth:1,borderColor:'#35404D',borderRadius:12,alignItems:'center',justifyContent:'center' },
  coverChoices: { flexDirection:'row',gap:10,marginTop:18 },
  coverChoice: { flex:1,minHeight:85,borderWidth:1,borderColor:'#35404D',borderRadius:14,alignItems:'center',justifyContent:'center',gap:8,padding:10 },
  sectionLabel: { color:'#F6F2EC',fontSize:14,fontWeight:'700',marginBottom:8 },
  captionInput: { minHeight:76,color:'#F6F2EC',fontSize:15,lineHeight:21,textAlignVertical:'top',backgroundColor:'#141D27',borderWidth:1,borderColor:'#35404D',borderRadius:13,padding:13 },
  captionStyle: { flex:1,minHeight:72,alignItems:'center',justifyContent:'center',gap:4,borderWidth:1,borderColor:'#35404D',borderRadius:13 },
  timeFields: { flexDirection:'row',gap:12,marginTop:14 },
  timeInput: { minHeight:44,borderWidth:1,borderColor:'#35404D',borderRadius:10,color:'#FFF',paddingHorizontal:12,marginTop:5 },
  captionRow: { flexDirection:'row',alignItems:'center',gap:12,minHeight:48,paddingLeft:12,borderRadius:12,borderWidth:1,borderColor:'#35404D',marginTop:10 },
  removeCaption: { width:44,height:44,alignItems:'center',justifyContent:'center' },
  toolLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '600' },
}));
