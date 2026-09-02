/**
 * PostMediaEditSheet - the edit stage between picking media and posting.
 * Reuses the story engine (MediaCanvas transform + fit, filter with strength,
 * Adjust, trim strip, mute) and returns a non-destructive PostMediaEdit recipe
 * stored on post_media.edit. The original file is never touched.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Animated, Dimensions, TextInput, Image, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import TierName from './TierName';
import VerifiedBadge from './VerifiedBadge';
import { supabase } from '../services/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import MediaCanvas from './stories/MediaCanvas';
import type { MediaTransform, MediaFit } from '../services/storiesService';
import { FilterPickerSheet, FilterLayer } from './stories/StoryFilters';
import { AdjustPanel, AdjustLayer, type StoryAdjust } from './stories/storyPanels';
import TrimStrip from './stories/TrimStrip';

export type PostMediaEdit = {
  scale?: number; translateNX?: number; translateNY?: number; fit?: 'cover' | 'contain';
  filterId?: string | null; filterAmt?: number; adjust?: StoryAdjust | null;
  trimStart?: number | null; trimEnd?: number | null; muted?: boolean;
  /** Tagged people, anchored by normalised position; saved to post_media_tags on publish, not kept in the recipe. */
  tags?: MediaTagDraft[] | null;
};
export type MediaTagDraft = { user_id: string; nx: number; ny: number; full_name?: string | null; username?: string | null; avatar_url?: string | null };

const SCREEN_W = Dimensions.get('window').width;

export default function PostMediaEditSheet({ visible, uri, mediaType, width, height, durationSec, initial, onDone, onCancel }: {
  visible: boolean; uri: string | null; mediaType: 'image' | 'video'; width?: number; height?: number; durationSec?: number;
  initial?: PostMediaEdit | null; onDone: (edit: PostMediaEdit) => void; onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [edit, setEdit] = useState<PostMediaEdit>(initial || {});
  const [filterOpen, setFilterOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [player, setPlayer] = useState<any>(null);
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
  React.useEffect(() => { if (visible) { setEdit(initial || {}); setDur(durationSec || 0); } }, [visible]);
  const ratio = width && height && width > 0 && height > 0 ? width / height : 4 / 5;
  const canvasW = SCREEN_W;
  const canvasH = Math.max(240, Math.min(SCREEN_W * 1.25, canvasW / ratio));
  const tx: MediaTransform = { scale: edit.scale ?? 1, translateNX: edit.translateNX ?? 0, translateNY: edit.translateNY ?? 0 } as MediaTransform;
  const fit: MediaFit = (edit.fit || 'cover') as MediaFit;
  const setTx = useCallback((t: MediaTransform) => setEdit(e => ({ ...e, scale: t.scale, translateNX: t.translateNX, translateNY: t.translateNY })), []);
  const isVideo = mediaType === 'video';
  const trimEnd = edit.trimEnd ?? (dur > 0 ? dur : null);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <View style={[st.root, { paddingTop: insets.top }]}>
        <View style={st.top}>
          <TouchableOpacity onPress={onCancel} style={st.topBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="x" size={22} color="#FFF" /></TouchableOpacity>
          <Text style={st.title}>Edit</Text>
          <TouchableOpacity onPress={() => onDone(edit)} style={st.done} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.doneTxt}>Done</Text></TouchableOpacity>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ width: canvasW, height: canvasH, backgroundColor: '#000', overflow: 'hidden' }}>
            <MediaCanvas localUri={uri} mediaType={mediaType} uploadState="idle" onRetry={() => {}} onLayout={() => {}} scaleAnim={scaleAnim} opacityAnim={opacityAnim}
              imageW={width} imageH={height} mediaFit={fit} mediaTransform={tx} onTransformChange={setTx}
              onFitToggle={() => setEdit(e => ({ ...e, fit: (e.fit || 'cover') === 'cover' ? 'contain' : 'cover' }))} interactive
              videoMuted={!!edit.muted} videoVolume={edit.muted ? 0 : 1} trimStart={edit.trimStart ?? null} trimEnd={edit.trimEnd ?? null} onVideoPlayer={setPlayer}>
              <FilterLayer filterId={edit.filterId || null} amt={edit.filterAmt ?? 100} />
              <AdjustLayer adjust={edit.adjust || null} />
            </MediaCanvas>
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
          {isVideo && !!uri && (
            <View style={{ alignItems: 'center', marginTop: 12 }}>
              <TrimStrip uri={uri} durationSec={dur || 15} start={edit.trimStart ?? 0} end={trimEnd ?? Math.min(dur || 15, 600)}
                onChange={(s2, e2) => setEdit(e => ({ ...e, trimStart: Math.round(s2 * 10) / 10, trimEnd: Math.round(e2 * 10) / 10 }))}
                onDuration={(d) => setDur(d)} player={player} width={SCREEN_W - 24} />
            </View>
          )}
        </View>
        <View style={[st.tools, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          {([
            { id: 'filter', label: 'Filter', icon: 'droplet', on: !!edit.filterId, run: () => setFilterOpen(true) },
            { id: 'adjust', label: 'Adjust', icon: 'sliders', on: !!edit.adjust, run: () => setAdjustOpen(true) },
            { id: 'fit', label: fit === 'contain' ? 'Fill' : 'Fit', icon: 'crop', on: fit === 'contain', run: () => setEdit(e => ({ ...e, fit: (e.fit || 'cover') === 'cover' ? 'contain' : 'cover' })) },
            ...(!isVideo ? [{ id: 'tag', label: tagMode ? 'Done tagging' : 'Tag people', icon: 'user-plus', on: tagMode || !!(edit.tags && edit.tags.length), run: () => setTagMode(m => !m) }] : []),
            ...(isVideo ? [{ id: 'mute', label: edit.muted ? 'Unmute' : 'Mute', icon: edit.muted ? 'volume-x' : 'volume-2', on: !!edit.muted, run: () => setEdit(e => ({ ...e, muted: !e.muted })) }] : []),
            { id: 'reset', label: 'Reset', icon: 'rotate-ccw', on: false, run: () => setEdit({}) },
          ] as { id: string; label: string; icon: any; on: boolean; run: () => void }[]).map(t => (
            <TouchableOpacity key={t.id} style={st.tool} onPress={t.run} activeOpacity={0.75}>
              <View style={[st.toolIcon, t.on && st.toolIconOn]}><Feather name={t.icon} size={20} color="#FFF" /></View>
              <Text style={st.toolLabel}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
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
        <FilterPickerSheet visible={filterOpen} onClose={() => setFilterOpen(false)} selected={edit.filterId || null} onSelect={(id: string | null) => setEdit(e => ({ ...e, filterId: id }))} previewUri={uri} />
        <AdjustPanel visible={adjustOpen} onClose={() => setAdjustOpen(false)} adjust={edit.adjust || {}} onChange={(a) => setEdit(e => ({ ...e, adjust: Object.keys(a).some(k => (a as any)[k] != null) ? a : null }))}
          filterOn={!!edit.filterId} filterAmt={edit.filterAmt ?? 100} onFilterAmt={(v) => setEdit(e => ({ ...e, filterAmt: v }))} />
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0D12' },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 48 },
  topBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  title: { flex: 1, textAlign: 'center', color: '#FFF', fontSize: 16, fontWeight: '800' },
  done: { backgroundColor: '#C9BFB0', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8 },
  doneTxt: { color: '#0B1E3D', fontSize: 14, fontWeight: '800' },
  tools: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 12, paddingHorizontal: 8 },
  tool: { alignItems: 'center', width: 64 },
  toolIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  toolIconOn: { backgroundColor: 'rgba(201,191,176,0.35)' },
  toolLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '600' },
});
