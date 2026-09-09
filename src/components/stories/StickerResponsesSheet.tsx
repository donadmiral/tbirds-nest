import { supabase } from '../../services/supabase';
import VerifiedBadge from '../VerifiedBadge';
import TierName from '../TierName';
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  FlatList, Image, ActivityIndicator, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from '../SafeArea';
import { Feather } from '@expo/vector-icons';
import { storiesService, type StickerResponse } from '../../services/storiesService';

const SCREEN_H = Dimensions.get('window').height;
const NAVY = '#0B1E3D';

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type StickerResponsesSheetProps = {
  visible: boolean;
  onClose: () => void;
  storyId: string;
  stickerId: string;
  responseType: 'question' | 'slider' | 'quiz' | 'magic';
  title: string;
  quizOptions?: { id: string; label: string; isCorrect: boolean }[];
  onShareResponse?: (text: string, responder: { id: string; username: string | null; full_name: string | null }) => void;
  onMessageResponder?: (userId: string, text: string) => void;
  onShareResults?: (rows: { label: string; pct: number; correct?: boolean }[], total: number) => void;
};

export default function StickerResponsesSheet({
  visible,
  onClose,
  storyId,
  stickerId,
  responseType,
  title,
  onShareResponse,
  onMessageResponder,
  onShareResults,
  quizOptions,
}: StickerResponsesSheetProps) {
  const insets = useSafeAreaInsets();
  const [responses, setResponses] = useState<StickerResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const loadResponses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await storiesService.getStickerResponses(storyId, stickerId);
      setResponses(data);
    } catch (e) {
      console.log('[StickerResponsesSheet.load]', e);
    } finally {
      setLoading(false);
    }
  }, [storyId, stickerId]);

  useEffect(() => {
    if (visible) loadResponses();
  }, [visible, loadResponses]);

  const renderResponse = useCallback(({ item }: { item: StickerResponse }) => {
    return (
      <View style={s.responseRow}>
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={s.avatar} />
        ) : (
          <View style={[s.avatar, s.avatarFb]}>
            <Text style={s.avatarTxt}>{initials(item.full_name)}</Text>
          </View>
        )}
        <View style={s.responseInfo}>
          <Text style={s.responseName} numberOfLines={1}><TierName userId={((item) as any)?.id ?? ((item) as any)?.user_id} baseStyle={s.responseName} text={item.full_name || 'User' || ''} numberOfLines={1} /> <VerifiedBadge userId={((item) as any)?.id ?? ((item) as any)?.user_id} size={12} /></Text>
          {responseType === 'question' && item.text_value && (
            <View>
              <Text style={s.responseValue} numberOfLines={2}>{item.text_value}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                {onMessageResponder ? <TouchableOpacity onPress={() => onMessageResponder(item.user_id, item.text_value || '')} activeOpacity={0.8} style={{ borderRadius: 999, borderWidth: 1, borderColor: 'rgba(11,30,61,0.2)', paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ fontSize: 12, fontWeight: '800', color: '#0B1E3D' }}>Reply</Text></TouchableOpacity> : null}
                {onShareResponse ? <TouchableOpacity onPress={() => onShareResponse(item.text_value || '', { id: item.user_id, username: item.username ?? null, full_name: item.full_name ?? null })} activeOpacity={0.8} style={{ borderRadius: 999, borderWidth: 1, borderColor: 'rgba(11,30,61,0.2)', paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ fontSize: 12, fontWeight: '800', color: '#0B1E3D' }}>Share to story</Text></TouchableOpacity> : null}
              </View>
            </View>
          )}
          {responseType === 'slider' && item.number_value != null && (
            <View style={s.sliderRow}>
              <View style={s.sliderBarBg}>
                <View style={[s.sliderBarFill, { width: `${Math.round(item.number_value * 100)}%` }]} />
              </View>
              <Text style={s.sliderPct}>{Math.round(item.number_value * 100)}%</Text>
            </View>
          )}
          {responseType === 'magic' && item.text_value ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <Text style={s.responseValue} numberOfLines={1}>Got: {item.text_value}</Text>
              {onShareResponse ? <TouchableOpacity onPress={() => onShareResponse(item.text_value || '', { id: item.user_id, username: item.username ?? null, full_name: item.full_name ?? null })} activeOpacity={0.8} style={{ borderRadius: 999, borderWidth: 1, borderColor: 'rgba(11,30,61,0.2)', paddingHorizontal: 10, paddingVertical: 3 }}><Text style={{ fontSize: 12, fontWeight: '800', color: '#0B1E3D' }}>Share result</Text></TouchableOpacity> : null}
            </View>
          ) : null}
          {responseType === 'quiz' && item.option_id && (() => {
            const opt = quizOptions?.find(o => o.id === item.option_id);
            const isCorrect = opt?.isCorrect ?? false;
            return (
              <View style={s.quizAnswerRow}>
                <Feather name={isCorrect ? 'check-circle' : 'x-circle'} size={13} color={isCorrect ? '#34C759' : '#FF3B30'} />
                <Text style={[s.quizAnswerTxt, { color: isCorrect ? '#34C759' : '#FF3B30' }]}>
                  {opt?.label || 'Unknown'}
                </Text>
              </View>
            );
          })()}
        </View>
        <Text style={s.responseTime}>{timeAgo(item.created_at)}</Text>
      </View>
    );
  }, [responseType, quizOptions]);

  const typeLabel = responseType === 'question' ? 'Answers' : responseType === 'slider' ? 'Ratings' : responseType === 'magic' ? 'Shakes' : 'Responses';
  // Hidden words from the owner's profile keep matching answers out of the list.
  const [hiddenWords, setHiddenWords] = useState<string[]>([]);
  useEffect(() => { (async () => { try { const { data: a } = await supabase.auth.getUser(); const id = a.user?.id; if (!id) return; const { data } = await supabase.from('profiles').select('hidden_words').eq('id', id).maybeSingle(); setHiddenWords((((data as any)?.hidden_words) || []).map((w: string) => String(w).toLowerCase())); } catch {} })(); }, []);
  const visibleResponses = responses.filter((r) => { if (!hiddenWords.length || !r.text_value) return true; const low = r.text_value.toLowerCase(); return !hiddenWords.some((w) => w && low.includes(w)); });
  const hiddenCount = responses.length - visibleResponses.length;
  const quizRows = (() => { if (responseType !== 'quiz' || !quizOptions?.length) return null; const total = responses.filter((r) => r.option_id).length; return { total, rows: quizOptions.map((o) => ({ label: o.label, pct: total ? (responses.filter((r) => r.option_id === o.id).length / total) * 100 : 0, correct: o.isCorrect })) }; })();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom + 16, 24) }]}>
          <View style={s.handle} />
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Text style={s.headerTitle}>{typeLabel}</Text>
              <Text style={s.headerCount}>{responses.length}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.headerClose}>
              <Feather name="x" size={20} color="#333" />
            </TouchableOpacity>
          </View>

          <Text style={s.promptText} numberOfLines={2}>{title}</Text>
          {quizRows && onShareResults ? <TouchableOpacity onPress={() => onShareResults(quizRows.rows, quizRows.total)} activeOpacity={0.85} style={{ alignSelf: 'flex-start', marginBottom: 8, borderRadius: 999, backgroundColor: '#0B1E3D', paddingHorizontal: 14, paddingVertical: 7 }}><Text style={{ color: '#FFF', fontSize: 12.5, fontWeight: '800' }}>Share results</Text></TouchableOpacity> : null}
          {hiddenCount > 0 ? <Text style={{ fontSize: 12, color: 'rgba(11,30,61,0.5)', marginBottom: 6 }}>{hiddenCount} hidden by your hidden words</Text> : null}

          {loading ? (
            <View style={s.loader}>
              <ActivityIndicator color={NAVY} size="small" />
            </View>
          ) : responses.length === 0 ? (
            <View style={s.empty}>
              <Feather name="inbox" size={24} color="#D1D5DB" />
              <Text style={s.emptyTxt}>No {typeLabel.toLowerCase()} yet</Text>
            </View>
          ) : (
            <FlatList
              data={visibleResponses}
              keyExtractor={r => r.id}
              renderItem={renderResponse}
              keyboardShouldPersistTaps="handled"
              style={s.list}
              contentContainerStyle={s.listContent}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    maxHeight: SCREEN_H * 0.65,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000',
  },
  headerCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  headerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: 8,
  },
  loader: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyTxt: {
    fontSize: 14,
    color: '#8E8E93',
  },
  responseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F5F5F5',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarFb: {
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: NAVY,
  },
  responseInfo: {
    flex: 1,
  },
  responseName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 3,
  },
  responseValue: {
    fontSize: 13,
    color: '#333',
    lineHeight: 18,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  sliderBarBg: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#F0F0F0',
    overflow: 'hidden',
  },
  sliderBarFill: {
    height: '100%',
    backgroundColor: NAVY,
    borderRadius: 2,
  },
  sliderPct: {
    fontSize: 12,
    fontWeight: '700',
    color: NAVY,
    minWidth: 32,
  },
  quizAnswerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  quizAnswerTxt: {
    fontSize: 13,
    fontWeight: '600',
  },
  responseTime: {
    fontSize: 11,
    color: '#C7C7CC',
    marginTop: 2,
  },
});