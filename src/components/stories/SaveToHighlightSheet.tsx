import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Image,
  TextInput,
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { storiesService, type StoryHighlight } from '../../services/storiesService';

const SCREEN_H = Dimensions.get('window').height;
const NAVY = '#0B1E3D';

type SaveToHighlightSheetProps = {
  visible: boolean;
  onClose: () => void;
  storyId: string;
  userId: string;
};

export default function SaveToHighlightSheet({
  visible,
  onClose,
  storyId,
  userId,
}: SaveToHighlightSheetProps) {
  const insets = useSafeAreaInsets();

  const [highlights, setHighlights] = useState<StoryHighlight[]>([]);
  const [savedIn, setSavedIn] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const [createMode, setCreateMode] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const loadHighlights = useCallback(async () => {
    setLoading(true);
    try {
      const list = await storiesService.getUserHighlights(userId);
      setHighlights(list);

      const inSet = new Set<string>();
      for (const h of list) {
        const stories = await storiesService.getHighlightStories(h.id);
        if (stories.some(s => s.id === storyId)) {
          inSet.add(h.id);
        }
      }
      setSavedIn(inSet);
    } catch (e) {
      console.log('[SaveToHighlight.load]', e);
    } finally {
      setLoading(false);
    }
  }, [userId, storyId]);

  useEffect(() => {
    if (visible) {
      loadHighlights();
      setCreateMode(false);
      setNewTitle('');
    }
  }, [visible, loadHighlights]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const toggleHighlight = useCallback(async (highlightId: string) => {
    if (toggling) return;
    setToggling(highlightId);
    const isCurrentlySaved = savedIn.has(highlightId);

    setSavedIn(prev => {
      const next = new Set(prev);
      if (isCurrentlySaved) next.delete(highlightId);
      else next.add(highlightId);
      return next;
    });

    try {
      if (isCurrentlySaved) {
        await storiesService.removeStoryFromHighlight(highlightId, storyId);
      } else {
        await storiesService.addStoryToHighlight(highlightId, storyId);
      }
    } catch (e) {
      console.log('[SaveToHighlight.toggle]', e);
      setSavedIn(prev => {
        const next = new Set(prev);
        if (isCurrentlySaved) next.add(highlightId);
        else next.delete(highlightId);
        return next;
      });
    } finally {
      setToggling(null);
    }
  }, [toggling, savedIn, storyId]);

  const createHighlight = useCallback(async () => {
    const trimmed = newTitle.trim();
    if (!trimmed || creating) return;
    if (trimmed.length > 30) {
      Alert.alert('Too long', 'Keep the title under 30 characters.');
      return;
    }
    setCreating(true);
    try {
      const created = await storiesService.createHighlight(trimmed);
      await storiesService.addStoryToHighlight(created.id, storyId);
      setNewTitle('');
      setCreateMode(false);
      Keyboard.dismiss();
      await loadHighlights();
    } catch (e: any) {
      console.log('[SaveToHighlight.create]', e);
      Alert.alert('Error', e?.message || 'Could not create highlight.');
    } finally {
      setCreating(false);
    }
  }, [newTitle, creating, storyId, loadHighlights]);

  const renderHighlightItem = useCallback(({ item }: { item: StoryHighlight }) => {
    const isSaved = savedIn.has(item.id);
    const isToggling = toggling === item.id;
    const coverUri = item.cover_url || item.latest_story_media_url;
    return (
      <TouchableOpacity
        style={s.highlightRow}
        onPress={() => toggleHighlight(item.id)}
        activeOpacity={0.7}
        disabled={!!toggling}
      >
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={s.highlightCover} />
        ) : (
          <LinearGradient
            colors={['#667eea', '#764ba2']}
            style={s.highlightCover}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={s.highlightCoverLetter}>
              {item.title.charAt(0).toUpperCase()}
            </Text>
          </LinearGradient>
        )}
        <View style={s.highlightInfo}>
          <Text style={s.highlightTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={s.highlightCount}>
            {item.story_count} {item.story_count === 1 ? 'story' : 'stories'}
          </Text>
        </View>
        {isToggling ? (
          <ActivityIndicator size="small" color={NAVY} />
        ) : (
          <View style={[s.checkbox, isSaved && s.checkboxActive]}>
            {isSaved && <Feather name="check" size={14} color="#FFF" />}
          </View>
        )}
      </TouchableOpacity>
    );
  }, [savedIn, toggling, toggleHighlight]);

  const listHeader = (
    <>
      {createMode ? (
        <View style={s.createRow}>
          <View style={s.createInputWrap}>
            <TextInput
              style={s.createInput}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Highlight name..."
              placeholderTextColor="#999"
              maxLength={30}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={createHighlight}
              blurOnSubmit={false}
            />
            <Text style={s.createCharCount}>{newTitle.length}/30</Text>
          </View>
          <TouchableOpacity
            style={[s.createBtn, (!newTitle.trim() || creating) && s.createBtnDisabled]}
            onPress={createHighlight}
            disabled={!newTitle.trim() || creating}
            activeOpacity={0.85}
          >
            {creating ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={s.createBtnTxt}>Create</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.createCancelBtn}
            onPress={() => { setCreateMode(false); setNewTitle(''); Keyboard.dismiss(); }}
            activeOpacity={0.7}
          >
            <Feather name="x" size={16} color="#8E8E93" />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={s.newRow} onPress={() => setCreateMode(true)} activeOpacity={0.7}>
          <View style={s.newIcon}>
            <Feather name="plus" size={18} color={NAVY} />
          </View>
          <Text style={s.newTxt}>New Highlight</Text>
        </TouchableOpacity>
      )}
      {loading && (
        <View style={s.loader}>
          <ActivityIndicator color={NAVY} size="small" />
        </View>
      )}
      {!loading && highlights.length === 0 && (
        <View style={s.empty}>
          <Feather name="bookmark" size={24} color="#D1D5DB" />
          <Text style={s.emptyTxt}>No highlights yet</Text>
          <Text style={s.emptySub}>Create one above to save stories permanently.</Text>
        </View>
      )}
    </>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={s.kavRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.bottom : 0}
      >
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={handleClose} />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom + 16, 24) }]}>
          <View style={s.handle} />

          <View style={s.header}>
            <Text style={s.headerTitle}>Save to Highlight</Text>
            <TouchableOpacity onPress={handleClose} style={s.headerClose}>
              <Feather name="x" size={20} color="#333" />
            </TouchableOpacity>
          </View>

          <FlatList
            data={loading ? [] : highlights}
            keyExtractor={h => h.id}
            renderItem={renderHighlightItem}
            ListHeaderComponent={listHeader}
            keyboardShouldPersistTaps="handled"
            style={s.list}
            contentContainerStyle={s.listContent}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  kavRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  backdrop: {
    flex: 1,
  },
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
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000',
  },
  headerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  newIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newTxt: {
    fontSize: 15,
    fontWeight: '600',
    color: NAVY,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  createInputWrap: {
    flex: 1,
  },
  createInput: {
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingRight: 50,
    fontSize: 15,
    color: '#000',
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
  },
  createCharCount: {
    position: 'absolute',
    right: 12,
    top: 14,
    fontSize: 11,
    color: '#C7C7CC',
  },
  createBtn: {
    backgroundColor: NAVY,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
    minWidth: 72,
    alignItems: 'center',
  },
  createBtnDisabled: {
    opacity: 0.35,
  },
  createBtnTxt: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  createCancelBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingVertical: 36,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 6,
  },
  emptyTxt: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginTop: 8,
  },
  emptySub: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 18,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F5F5F5',
  },
  highlightCover: {
    width: 46,
    height: 46,
    borderRadius: 23,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightCoverLetter: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 18,
  },
  highlightInfo: {
    flex: 1,
  },
  highlightTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
  },
  highlightCount: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: NAVY,
    borderColor: NAVY,
  },
});