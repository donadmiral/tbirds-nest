import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  FlatList, Image, ActivityIndicator, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  responseType: 'question' | 'slider' | 'quiz';
  title: string;
  quizOptions?: { id: string; label: string; isCorrect: boolean }[];
};

export default function StickerResponsesSheet({
  visible,
  onClose,
  storyId,
  stickerId,
  responseType,
  title,
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
          <Text style={s.responseName} numberOfLines={1}>{item.full_name || 'User'}</Text>
          {responseType === 'question' && item.text_value && (
            <Text style={s.responseValue} numberOfLines={2}>{item.text_value}</Text>
          )}
          {responseType === 'slider' && item.number_value != null && (
            <View style={s.sliderRow}>
              <View style={s.sliderBarBg}>
                <View style={[s.sliderBarFill, { width: `${Math.round(item.number_value * 100)}%` }]} />
              </View>
              <Text style={s.sliderPct}>{Math.round(item.number_value * 100)}%</Text>
            </View>
          )}
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

  const typeLabel = responseType === 'question' ? 'Answers' : responseType === 'slider' ? 'Ratings' : 'Responses';

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
              data={responses}
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