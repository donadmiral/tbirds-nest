/**
 * storyPanels — creative-engine sheets and layers: adjust, background,
 * sound mix, entity picker, and the composer's phone-frame preview.
 * All values persist as plain JSON inside media_transform so the web
 * viewer replays them from the same numbers.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, PanResponder, TextInput, ScrollView, ActivityIndicator, Dimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';

const SCREEN_W = Dimensions.get('window').width;

export type StoryAdjust = { bri?: number; con?: number; warm?: number; tint?: number; sat?: number; hi?: number; sh?: number; fade?: number; grain?: number; vig?: number };
export type StoryBg = { kind: 'blur' | 'color' | 'gradient' | 'none'; a?: string; b?: string };
export type StoryMix = { orig?: number; music?: number };
export type EntityPick = { entityType: 'profile' | 'listing' | 'job' | 'article'; entityId: string; entityTitle: string; entitySub?: string; entityImage?: string | null };

/* ── MiniSlider: dependency-free track used by every panel ── */
export function MiniSlider({ value, min, max, onChange, width = 210, onDragStateChange }: { value: number; min: number; max: number; onChange: (v: number) => void; width?: number; onDragStateChange?: (dragging: boolean) => void }) {
  // Stable slider: the thumb follows the finger from where it was grabbed (no
  // jump on touch), the visual updates locally every frame, and the parent is
  // committed at most every 60ms plus once on release, so the editor never
  // re-renders per touch event.
  const wRef = useRef(width); wRef.current = width;
  const minRef = useRef(min); minRef.current = min;
  const maxRef = useRef(max); maxRef.current = max;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const onDragRef = useRef(onDragStateChange); onDragRef.current = onDragStateChange;
  const [live, setLive] = useState(value);
  const [dragging, setDragging] = useState(false);
  const liveRef = useRef(value);
  const draggingRef = useRef(false);
  const startValRef = useRef(value);
  const lastCommitRef = useRef(0);
  const lastSentRef = useRef(value);
  useEffect(() => { if (!draggingRef.current) { liveRef.current = value; setLive(value); } }, [value]);
  const toVal = (x: number) => { const w = Math.max(1, wRef.current); const lo = minRef.current, hi = maxRef.current; return Math.round(Math.max(lo, Math.min(hi, lo + (Math.max(0, Math.min(w, x)) / w) * (hi - lo)))); };
  const toX = (v: number) => { const lo = minRef.current, hi = maxRef.current; return ((v - lo) / (hi - lo || 1)) * wRef.current; };
  const commit = (v: number, force: boolean) => {
    const now = Date.now();
    if (!force && now - lastCommitRef.current < 60) return;
    if (v === lastSentRef.current && !force) return;
    lastCommitRef.current = now; lastSentRef.current = v; onChangeRef.current(v);
  };
  const pan = useRef(PanResponder.create({
    // The slider must never steal a scroll. It claims the gesture only once
    // the finger has clearly moved sideways, and a plain touch changes nothing.
    // A touch that begins on the track is meant for the slider. Claim it at once:
    // waiting for sideways movement lets the sheet's ScrollView take the gesture
    // natively first, and the thumb never moves. The panel disables its own
    // scrolling while a slider is held, so this never fights a real scroll.
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      draggingRef.current = true; setDragging(true); onDragRef.current?.(true);
      // Always start from the current value: the finger drags it relatively,
      // so nothing jumps to where you happened to touch.
      startValRef.current = liveRef.current;
    },
    onPanResponderMove: (_e, g) => {
      // Half-speed travel: a full sweep of the track moves roughly half the
      // range, which is what makes fine adjustment possible with a thumb.
      const v = toVal(toX(startValRef.current) + g.dx * 0.55);
      if (v !== liveRef.current) { liveRef.current = v; setLive(v); commit(v, false); }
    },
    onPanResponderRelease: () => { draggingRef.current = false; setDragging(false); onDragRef.current?.(false); commit(liveRef.current, true); },
    onPanResponderTerminate: () => { draggingRef.current = false; setDragging(false); onDragRef.current?.(false); commit(liveRef.current, true); },
  })).current;
  const pct = (live - min) / (max - min || 1);
  const thumbLeft = Math.max(0, Math.min(width - 18, pct * width - 9));
  return (
    <View {...pan.panHandlers} style={[sl.track, { width }]} hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}>
      <View style={[sl.fill, { width: Math.max(4, pct * width) }]} />
      {dragging && (
        <View style={[sl.bubble, { left: Math.max(0, Math.min(width - 40, thumbLeft - 11)) }]} pointerEvents="none">
          <Text style={sl.bubbleTxt}>{live}</Text>
        </View>
      )}
      <View style={[sl.thumb, dragging && sl.thumbActive, { left: thumbLeft }]} />
    </View>
  );
}

/* ── AdjustLayer: overlay approximation of the stored numbers ──
 * Phone renders lightweight tint/gradient overlays; web renders exact
 * CSS filters from the SAME stored values. Close enough to art-direct,
 * identical data underneath.
 */
/** Film grain: a fixed lattice of faint dots. Deterministic, so the composer
 *  and both viewers draw the identical pattern from the same amount. */
function GrainLayer({ amount }: { amount: number }) {
  const dots = React.useMemo(() => {
    const out: { top: string; left: string; o: number; s: number }[] = [];
    let seed = 9301;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 220; i++) out.push({ top: (rnd() * 100).toFixed(2) + '%', left: (rnd() * 100).toFixed(2) + '%', o: 0.25 + rnd() * 0.75, s: rnd() > 0.5 ? 2 : 1 });
    return out;
  }, []);
  const k = Math.max(0, Math.min(100, amount)) / 100;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {dots.map((d, i) => (
        <View key={i} pointerEvents="none" style={{ position: 'absolute', top: d.top as any, left: d.left as any, width: d.s, height: d.s, borderRadius: d.s, backgroundColor: i % 2 ? '#FFFFFF' : '#000000', opacity: d.o * k * 0.35 }} />
      ))}
    </View>
  );
}

export function AdjustLayer({ adjust, zIndex }: { adjust: StoryAdjust | null | undefined; zIndex?: number }) {
  if (!adjust || typeof adjust !== 'object') return null;
  const bri = clampN(adjust.bri), warm = clampN(adjust.warm), tint = clampN(adjust.tint), sat = clampN(adjust.sat), fade = clamp0(adjust.fade), vig = clamp0(adjust.vig);
  const con = clampN((adjust as any).con), hi = clampN((adjust as any).hi), sh = clampN((adjust as any).sh), grain = clamp0((adjust as any).grain);
  if (!bri && !con && !warm && !tint && !sat && !hi && !sh && !fade && !grain && !vig) return null;
  const layers: { color: string; opacity: number }[] = [];
  if (bri > 0) layers.push({ color: '#FFFFFF', opacity: (bri / 100) * 0.35 });
  if (bri < 0) layers.push({ color: '#000000', opacity: (-bri / 100) * 0.4 });
  if (warm > 0) layers.push({ color: '#FF9E45', opacity: (warm / 100) * 0.22 });
  if (warm < 0) layers.push({ color: '#3D7DFF', opacity: (-warm / 100) * 0.2 });
  if (tint > 0) layers.push({ color: '#E14CCB', opacity: (tint / 100) * 0.16 });
  if (tint < 0) layers.push({ color: '#3DBB6A', opacity: (-tint / 100) * 0.16 });
  if (sat < 0) layers.push({ color: '#808080', opacity: (-sat / 100) * 0.5 });
  if (sat > 0) layers.push({ color: '#FF3D6E', opacity: (sat / 100) * 0.06 });
  if (fade > 0) layers.push({ color: '#D8D2C8', opacity: (fade / 100) * 0.28 });
  // Contrast: a light plane on the top half and a dark plane on the bottom
  // half of the tonal range is not possible without pixel access, so contrast
  // is expressed as paired hard-light-ish planes at low opacity, which reads
  // as punch without crushing the image.
  if (con > 0) layers.push({ color: '#000000', opacity: (con / 100) * 0.10 });
  if (con < 0) layers.push({ color: '#8A8A8A', opacity: (-con / 100) * 0.22 });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, zIndex != null ? { zIndex } : null]}>
      {layers.map((l, i) => (
        <View key={i} pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: l.color, opacity: l.opacity }]} />
      ))}
      {hi !== 0 && (
        <LinearGradient pointerEvents="none" colors={hi > 0 ? ['rgba(255,255,255,' + (hi / 100) * 0.22 + ')', 'rgba(255,255,255,0)'] : ['rgba(0,0,0,' + (-hi / 100) * 0.18 + ')', 'rgba(0,0,0,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      {sh !== 0 && (
        <LinearGradient pointerEvents="none" colors={sh > 0 ? ['rgba(255,255,255,0)', 'rgba(255,255,255,' + (sh / 100) * 0.18 + ')'] : ['rgba(0,0,0,0)', 'rgba(0,0,0,' + (-sh / 100) * 0.24 + ')']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      {grain > 0 && <GrainLayer amount={grain} />}
      {vig > 0 && (
        <>
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,' + (vig / 100) * 0.55 + ')', 'rgba(0,0,0,0)']} style={[StyleSheet.absoluteFill, { height: '32%' }]} />
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,' + (vig / 100) * 0.55 + ')']} style={[vg.bottom]} />
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,' + (vig / 100) * 0.4 + ')', 'rgba(0,0,0,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[vg.left]} />
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,' + (vig / 100) * 0.4 + ')']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[vg.right]} />
        </>
      )}
    </View>
  );
}
function clampN(v: any): number { const n = Number(v); if (!n || Number.isNaN(n)) return 0; return Math.max(-100, Math.min(100, n)); }
function clamp0(v: any): number { const n = Number(v); if (!n || Number.isNaN(n)) return 0; return Math.max(0, Math.min(100, n)); }

const ADJ_FIELDS: { key: keyof StoryAdjust; label: string; min: number; max: number }[] = [
  { key: 'bri', label: 'Brightness', min: -100, max: 100 },
  { key: 'con', label: 'Contrast', min: -100, max: 100 },
  { key: 'sat', label: 'Saturation', min: -100, max: 100 },
  { key: 'warm', label: 'Warmth', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'hi', label: 'Highlights', min: -100, max: 100 },
  { key: 'sh', label: 'Shadows', min: -100, max: 100 },
  { key: 'fade', label: 'Fade', min: 0, max: 100 },
  { key: 'grain', label: 'Grain', min: 0, max: 100 },
  { key: 'vig', label: 'Vignette', min: 0, max: 100 },
];

export function AdjustPanel({ visible, onClose, adjust, onChange, filterOn, filterAmt, onFilterAmt }: {
  visible: boolean; onClose: () => void;
  adjust: StoryAdjust; onChange: (a: StoryAdjust) => void;
  filterOn: boolean; filterAmt: number; onFilterAmt: (v: number) => void;
}) {
  const [sliding, setSliding] = useState(false);
  if (!visible) return null;
  const hasAny = ADJ_FIELDS.some(f => (adjust as any)[f.key]);
  return (
    <View style={pp.dockWrap} pointerEvents="box-none">
      <View style={pp.dock}>
        <View style={pp.dockHead}>
          <Text style={pp.dockTitle}>Adjust</Text>
          {(hasAny || filterAmt !== 100) && (
            <TouchableOpacity onPress={() => { onChange({}); onFilterAmt(100); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={pp.dockReset}>Reset</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={pp.dockDone} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={pp.dockDoneTxt}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 300 }} scrollEnabled={!sliding} bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
          {filterOn && (
            <View style={pp.row}>
              <Text style={pp.rowLabel}>Filter strength</Text>
              <MiniSlider value={filterAmt} min={0} max={100} onChange={onFilterAmt} onDragStateChange={setSliding} />
              <Text style={pp.rowVal}>{filterAmt}</Text>
            </View>
          )}
          {ADJ_FIELDS.map(f => (
            <View key={f.key as string} style={pp.row}>
              <Text style={pp.rowLabel}>{f.label}</Text>
              <MiniSlider value={Number((adjust as any)[f.key]) || 0} min={f.min} max={f.max} onChange={v => onChange({ ...adjust, [f.key]: v === 0 ? undefined : v })} onDragStateChange={setSliding} />
              <Text style={pp.rowVal}>{Number((adjust as any)[f.key]) || 0}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

/* ── Backgrounds for fit mode (doc 15) ── */
const BG_COLORS = ['#000000', '#FFFFFF', '#0B1E3D', '#C9BFB0', '#1E3A8A', '#7C2D12', '#14532D', '#581C87', '#9F1239', '#334155'];
const BG_GRADIENTS: [string, string][] = [
  ['#0B1E3D', '#3B5BA5'], ['#FF7A59', '#FFD166'], ['#5F0F40', '#FB8B24'], ['#134E5E', '#71B280'],
  ['#41295A', '#2F0743'], ['#F953C6', '#B91D73'], ['#00B4DB', '#0083B0'], ['#232526', '#414345'],
];

export function BackgroundLayer({ bg, mediaUrl }: { bg: StoryBg | null | undefined; mediaUrl?: string | null }) {
  if (!bg || bg.kind === 'blur' || !bg.kind) {
    if (!mediaUrl) return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />;
    return (
      <View style={StyleSheet.absoluteFill}>
        <ExpoImage source={{ uri: mediaUrl }} style={[StyleSheet.absoluteFill, { opacity: 0.22 }]} contentFit="cover" blurRadius={35} transition={0} cachePolicy="memory-disk" />
      </View>
    );
  }
  if (bg.kind === 'none') return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />;
  if (bg.kind === 'color') return <View style={[StyleSheet.absoluteFill, { backgroundColor: bg.a || '#000' }]} />;
  return <LinearGradient colors={[bg.a || '#000', bg.b || bg.a || '#000']} style={StyleSheet.absoluteFill} />;
}

export function BackgroundSheet({ visible, onClose, bg, onChange }: { visible: boolean; onClose: () => void; bg: StoryBg | null; onChange: (b: StoryBg) => void }) {
  if (!visible) return null;
  const isSel = (k: string, a?: string, b?: string) => !!bg && bg.kind === k && bg.a === a && bg.b === b;
  return (
    <View style={pp.dockWrap} pointerEvents="box-none">
      <View style={pp.dock}>
        <View style={pp.dockHead}>
          <Text style={pp.dockTitle}>Background</Text>
          <TouchableOpacity onPress={onClose} style={pp.dockDone} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={pp.dockDoneTxt}>Done</Text>
          </TouchableOpacity>
        </View>
        <Text style={pp.dockHint}>Shows around your media in fit mode.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 10, paddingVertical: 8 }}>
          <TouchableOpacity onPress={() => onChange({ kind: 'blur' })} style={[pp.bgTile, (!bg || bg.kind === 'blur') && pp.bgTileOn]}>
            <Feather name="droplet" size={16} color="#FFF" />
            <Text style={pp.bgTileTxt}>Blur</Text>
          </TouchableOpacity>
          {BG_COLORS.map(c => (
            <TouchableOpacity key={c} onPress={() => onChange({ kind: 'color', a: c })} style={[pp.bgSwatch, { backgroundColor: c }, isSel('color', c) && pp.bgTileOn]} />
          ))}
          {BG_GRADIENTS.map(([a, b]) => (
            <TouchableOpacity key={a + b} onPress={() => onChange({ kind: 'gradient', a, b })} style={[isSel('gradient', a, b) && pp.bgTileOn, { borderRadius: 21 }]}>
              <LinearGradient colors={[a, b]} style={pp.bgSwatchInner} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

/* ── Sound mix (docs 24/68): original vs music volume, stored 0-100 ── */
export function AudioMixSheet({ visible, onClose, isVideo, hasMusic, mix, onChange }: {
  visible: boolean; onClose: () => void; isVideo: boolean; hasMusic: boolean;
  mix: StoryMix; onChange: (m: StoryMix) => void;
}) {
  if (!visible) return null;
  const orig = typeof mix.orig === 'number' ? mix.orig : 100;
  const music = typeof mix.music === 'number' ? mix.music : 100;
  return (
    <View style={pp.dockWrap} pointerEvents="box-none">
      <View style={pp.dock}>
        <View style={pp.dockHead}>
          <Text style={pp.dockTitle}>Sound mix</Text>
          <TouchableOpacity onPress={onClose} style={pp.dockDone} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={pp.dockDoneTxt}>Done</Text>
          </TouchableOpacity>
        </View>
        {isVideo ? (
          <View style={pp.row}>
            <TouchableOpacity onPress={() => onChange({ ...mix, orig: orig === 0 ? 100 : 0 })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name={orig === 0 ? 'volume-x' : 'volume-2'} size={18} color="#FFF" />
            </TouchableOpacity>
            <Text style={pp.rowLabel}>Video sound</Text>
            <MiniSlider value={orig} min={0} max={100} onChange={v => onChange({ ...mix, orig: v })} width={170} />
            <Text style={pp.rowVal}>{orig}</Text>
          </View>
        ) : (
          <Text style={pp.dockHint}>Photo story — only music plays.</Text>
        )}
        <View style={pp.row}>
          <TouchableOpacity onPress={() => onChange({ ...mix, music: music === 0 ? 100 : 0 })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name={music === 0 ? 'volume-x' : 'music'} size={18} color="#FFF" />
          </TouchableOpacity>
          <Text style={pp.rowLabel}>Music</Text>
          <MiniSlider value={music} min={0} max={100} onChange={v => onChange({ ...mix, music: v })} width={170} />
          <Text style={pp.rowVal}>{music}</Text>
        </View>
        {!hasMusic && <Text style={pp.dockHint}>Add music from the tray to hear this channel.</Text>}
        <Text style={pp.dockHint}>Original audio is never deleted — the mix just sets playback volume.</Text>
      </View>
    </View>
  );
}

/* ── Entity picker (doc 49): tag a listing, job, person, or article ── */
export function EntitySheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (e: EntityPick) => void }) {
  const [tab, setTab] = useState<'people' | 'listings' | 'jobs' | 'articles'>('people');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<EntityPick[]>([]);
  const [loading, setLoading] = useState(false);
  const debRef = useRef<any>(null);

  useEffect(() => {
    if (!visible) return;
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const term = q.trim();
        let out: EntityPick[] = [];
        if (tab === 'people') {
          let qb = supabase.from('profiles').select('id, full_name, username, avatar_url').limit(14);
          if (term) qb = qb.or(`full_name.ilike.%${term}%,username.ilike.%${term}%`);
          const { data } = await qb;
          out = (data || []).map((r: any) => ({ entityType: 'profile', entityId: r.id, entityTitle: r.full_name || r.username || 'Member', entitySub: r.username ? '@' + r.username : undefined, entityImage: r.avatar_url }));
        } else if (tab === 'listings') {
          let qb = supabase.from('marketplace_listings').select('id, title, price, currency, images, location_city').eq('status', 'available').order('created_at', { ascending: false }).limit(14);
          if (term) qb = qb.ilike('title', `%${term}%`);
          const { data } = await qb;
          out = (data || []).map((r: any) => ({ entityType: 'listing', entityId: r.id, entityTitle: r.title, entitySub: [r.price != null ? `${r.currency || 'USD'} ${r.price}` : null, r.location_city].filter(Boolean).join(' · ') || undefined, entityImage: Array.isArray(r.images) && r.images[0] ? r.images[0] : null }));
        } else if (tab === 'jobs') {
          let qb = supabase.from('jobs').select('id, title, company, location').order('created_at', { ascending: false }).limit(14);
          if (term) qb = qb.or(`title.ilike.%${term}%,company.ilike.%${term}%`);
          const { data } = await qb;
          out = (data || []).map((r: any) => ({ entityType: 'job', entityId: r.id, entityTitle: r.title, entitySub: [r.company, r.location].filter(Boolean).join(' · ') || undefined, entityImage: null }));
        } else {
          let qb = supabase.from('posts').select('id, article_title, media_urls').not('article_title', 'is', null).order('created_at', { ascending: false }).limit(14);
          if (term) qb = qb.ilike('article_title', `%${term}%`);
          const { data } = await qb;
          out = (data || []).map((r: any) => ({ entityType: 'article', entityId: r.id, entityTitle: r.article_title, entitySub: 'Article', entityImage: Array.isArray(r.media_urls) && r.media_urls[0] ? r.media_urls[0] : null }));
        }
        setRows(out);
      } catch { setRows([]); }
      setLoading(false);
    }, 280);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [visible, tab, q]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={pv.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={pv.sheet}>
          <View style={pv.grabber} />
          <Text style={pv.title}>Tag in your story</Text>
          <View style={pv.tabs}>
            {(['people', 'listings', 'jobs', 'articles'] as const).map(t => (
              <TouchableOpacity key={t} onPress={() => setTab(t)} style={[pv.tab, tab === t && pv.tabOn]}>
                <Text style={[pv.tabTxt, tab === t && pv.tabTxtOn]}>{t === 'people' ? 'People' : t === 'listings' ? 'Market' : t === 'jobs' ? 'Jobs' : 'Articles'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={pv.searchWrap}>
            <Feather name="search" size={15} color="rgba(255,255,255,0.45)" />
            <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor="rgba(255,255,255,0.4)" style={pv.searchInput} autoCapitalize="none" autoCorrect={false} />
          </View>
          <ScrollView style={{ maxHeight: 330 }} keyboardShouldPersistTaps="handled">
            {loading && <ActivityIndicator color="#FFF" style={{ marginVertical: 20 }} />}
            {!loading && rows.length === 0 && <Text style={pv.empty}>Nothing found.</Text>}
            {!loading && rows.map(r => (
              <TouchableOpacity key={r.entityType + r.entityId} style={pv.row} onPress={() => { onPick(r); onClose(); }} activeOpacity={0.75}>
                {r.entityImage ? (
                  <ExpoImage source={{ uri: r.entityImage }} style={pv.rowImg} contentFit="cover" transition={0} />
                ) : (
                  <View style={[pv.rowImg, pv.rowImgEmpty]}>
                    <Feather name={r.entityType === 'listing' ? 'shopping-bag' : r.entityType === 'job' ? 'briefcase' : r.entityType === 'article' ? 'file-text' : 'user'} size={17} color="#C9BFB0" />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={pv.rowTitle} numberOfLines={1}>{r.entityTitle}</Text>
                  {!!r.entitySub && <Text style={pv.rowSub} numberOfLines={1}>{r.entitySub}</Text>}
                </View>
                <Feather name="plus-circle" size={19} color="#C9BFB0" />
              </TouchableOpacity>
            ))}
            <View style={{ height: 26 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ── PreviewChrome (doc 60): viewer-frame mock over the live canvas ── */
export function PreviewChrome({ name, avatarUrl, onClose }: { name: string; avatarUrl: string | null; onClose: () => void }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={pvv.topBand} pointerEvents="none">
        <View style={pvv.progressRow}>
          <View style={pvv.progressSeg}><View style={pvv.progressFill} /></View>
        </View>
        <View style={pvv.headRow}>
          {avatarUrl ? (
            <ExpoImage source={{ uri: avatarUrl }} style={pvv.avatar} contentFit="cover" transition={0} />
          ) : (
            <View style={[pvv.avatar, { backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }]}>
              <Feather name="user" size={14} color="#FFF" />
            </View>
          )}
          <Text style={pvv.name}>{name}</Text>
          <Text style={pvv.time}>now</Text>
        </View>
      </View>
      <View style={pvv.bottomBand} pointerEvents="none">
        <View style={pvv.replyMock}><Text style={pvv.replyMockTxt}>Send message</Text></View>
        <Feather name="heart" size={22} color="#FFF" />
        <Feather name="send" size={21} color="#FFF" />
      </View>
      <TouchableOpacity style={pvv.exitPill} onPress={onClose} activeOpacity={0.85}>
        <Feather name="x" size={14} color="#0B1E3D" />
        <Text style={pvv.exitTxt}>Exit preview</Text>
      </TouchableOpacity>
    </View>
  );
}

const sl = StyleSheet.create({
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: '#C9BFB0' },
  thumb: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF', top: -7, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  thumbActive: { transform: [{ scale: 1.25 }] },
  bubble: { position: 'absolute', top: -34, width: 40, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  bubbleTxt: { color: '#0B1E3D', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
});

const vg = StyleSheet.create({
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '32%' },
  left: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '22%' },
  right: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '22%' },
});

const pp = StyleSheet.create({
  dockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 60 },
  dock: { backgroundColor: 'rgba(12,14,20,0.96)', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingBottom: 30, borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  dockHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6, gap: 14 },
  dockTitle: { color: '#FFF', fontSize: 15.5, fontWeight: '800', flex: 1 },
  dockReset: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700' },
  dockDone: { backgroundColor: '#C9BFB0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
  dockDoneTxt: { color: '#0B1E3D', fontSize: 13, fontWeight: '800' },
  dockHint: { color: 'rgba(255,255,255,0.5)', fontSize: 11.5, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 7 },
  rowLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontWeight: '600', width: 86 },
  rowVal: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontVariant: ['tabular-nums'], width: 34, textAlign: 'right' },
  bgTile: { height: 42, paddingHorizontal: 12, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  bgTileOn: { borderWidth: 2, borderColor: '#C9BFB0' },
  bgTileTxt: { color: '#FFF', fontSize: 12.5, fontWeight: '700' },
  bgSwatch: { width: 42, height: 42, borderRadius: 21, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
  bgSwatchInner: { width: 42, height: 42, borderRadius: 21 },
});

const pv = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: '#14161D', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingBottom: 28 },
  grabber: { alignSelf: 'center', width: 40, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 10 },
  title: { color: '#FFF', fontSize: 16, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  tab: { flex: 1, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#C9BFB0' },
  tabTxt: { color: 'rgba(255,255,255,0.75)', fontSize: 12.5, fontWeight: '700' },
  tabTxtOn: { color: '#0B1E3D' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 8 },
  searchInput: { flex: 1, color: '#FFF', fontSize: 13.5, paddingVertical: 0 },
  empty: { color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center', marginVertical: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  rowImg: { width: 42, height: 42, borderRadius: 10 },
  rowImgEmpty: { backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  rowSub: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 1 },
});

const pvv = StyleSheet.create({
  topBand: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 54, paddingHorizontal: 12, zIndex: 70 },
  progressRow: { flexDirection: 'row', gap: 4 },
  progressSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  progressFill: { width: '42%', height: '100%', backgroundColor: '#FFF' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  avatar: { width: 30, height: 30, borderRadius: 15 },
  name: { color: '#FFF', fontSize: 13.5, fontWeight: '800' },
  time: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5 },
  bottomBand: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 40, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 14, zIndex: 70 },
  replyMock: { flex: 1, height: 42, borderRadius: 21, borderWidth: 1.2, borderColor: 'rgba(255,255,255,0.55)', justifyContent: 'center', paddingHorizontal: 16 },
  replyMockTxt: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  exitPill: { position: 'absolute', top: 116, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#C9BFB0', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 7, zIndex: 71 },
  exitTxt: { color: '#0B1E3D', fontSize: 12.5, fontWeight: '800' },
});
