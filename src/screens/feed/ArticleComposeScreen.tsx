/**
 * ArticleComposeScreen - long-form publishing. Title, optional cover,
 * the piece itself; read minutes computed from the words. Publishes
 * through the posts spine so the article card and reader just work.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator, Image, Platform, KeyboardAvoidingView, Modal } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { authorId as currentAuthorId } from '../../stores/actorStore';
import { feedService } from '../../services/feedService';
import ArticleBody from '../../components/ArticleBody';

const DRAFT_KEY = 'pc:article-draft';

const NAVY = '#0B1E3D';

export default function ArticleComposeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [coverDims, setCoverDims] = useState<{ width: number; height: number } | null>(null);
  const [galleryImages, setGalleryImages] = useState<{ url: string; width?: number; height?: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('https://');
  const bodyRef = useRef<TextInput>(null);
  const wordCount = useMemo(() => (body.trim() ? body.trim().split(/\s+/).length : 0), [body]);

  const minutes = useMemo(() => {
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }, [body]);

  // The draft outlives the screen: backgrounding the app or navigating away
  // by accident no longer loses the piece. Mirrors the web writer exactly.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw) as { title?: string; body?: string };
          if (d.title) setTitle(d.title);
          if (d.body) setBody(d.body);
        }
      } catch {}
    })();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (title || body) AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body })).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [title, body]);

  // Wraps the current selection (or inserts at the cursor), same shape as
  // the web toolbar's wrap(): heading/quote markers get a leading newline
  // when the cursor isn't already at a fresh line, everything else doesn't.
  function wrap(before: string, after: string) {
    const start = selection.start;
    const end = selection.end;
    const chosen = body.slice(start, end);
    const lineStart = before.startsWith('#') || before.startsWith('>') || before.startsWith('- ') || /^\d+\. /.test(before);
    const needsNewline = lineStart && start > 0 && body[start - 1] !== '\n';
    const insertion = (needsNewline ? '\n' : '') + before + chosen + after;
    const next = body.slice(0, start) + insertion + body.slice(end);
    setBody(next);
    const pos = start + insertion.length - after.length;
    requestAnimationFrame(() => {
      bodyRef.current?.focus();
      setSelection({ start: pos, end: pos });
    });
  }

  // Always gives `block` its own paragraph: guarantees a real blank line
  // before and after wherever the cursor sits, so an inserted image (or
  // any block-level markup) can never merge into surrounding text and get
  // read back as a plain paragraph instead of the block it's meant to be.
  function insertBlockAt(text: string, pos: number, block: string): { next: string; newPos: number } {
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const leadIn = before.length === 0 ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const leadOut = after.length === 0 ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const insertion = leadIn + block + leadOut;
    return { next: before + insertion + after, newPos: before.length + insertion.length };
  }

  const openLinkModal = () => {
    setLinkText(body.slice(selection.start, selection.end));
    setLinkUrl('https://');
    setLinkModalOpen(true);
  };

  const confirmLink = () => {
    const url = linkUrl.trim();
    if (!/^https?:\/\/.+/.test(url)) {
      Alert.alert('Add a real link', 'The link needs to start with https:// and have something after it.');
      return;
    }
    const text = linkText.trim() || url;
    const markdown = '[' + text + '](' + url + ')';
    const next = body.slice(0, selection.start) + markdown + body.slice(selection.end);
    setBody(next);
    const pos = selection.start + markdown.length;
    setLinkModalOpen(false);
    requestAnimationFrame(() => {
      bodyRef.current?.focus();
      setSelection({ start: pos, end: pos });
    });
  };

  const insertImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Photos', 'Allow photo access to add an image.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (res.canceled || !res.assets?.[0]?.uri || !profile?.id) return;
    try {
      const aid = currentAuthorId(profile.id) ?? profile.id;
      const url = await feedService.uploadPostImage(aid, res.assets[0].uri);
      if (url) {
        const { next, newPos } = insertBlockAt(body, selection.start, '![](' + url + ')');
        setBody(next);
        requestAnimationFrame(() => {
          bodyRef.current?.focus();
          setSelection({ start: newPos, end: newPos });
        });
      }
    } catch (e: any) {
      Alert.alert('Could not add image', e?.message || 'Try again.');
    }
  };

  const pickCover = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Photos', 'Allow photo access to add a cover.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (!res.canceled && res.assets?.[0]?.uri) {
      setCover(res.assets[0].uri);
      setCoverDims(res.assets[0].width && res.assets[0].height ? { width: res.assets[0].width, height: res.assets[0].height } : null);
    }
  };

// Same markup grammar ArticleBody reads, run the other way: turns the
// written text into the structured blocks Phase 2 storage expects.
// Kept in sync by hand with the identical function in the other platform's
// composer and with ArticleBody's own regexes - if one changes, all three do.
function bodyToBlocks(text: string): Record<string, unknown>[] {
  const H1 = /^# (.+)$/;
  const H2 = /^## (.+)$/;
  const QUOTE = /^> ?(.*)$/;
  const IMG = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/;
  const RULE = /^---+$/;
  const BULLET_LINE = /^- (.+)$/;
  const NUMBERED_LINE = /^\d+\. (.+)$/;
  const blocks: Record<string, unknown>[] = [];
  const rawBlocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const raw of rawBlocks) {
    const block = raw.trim();
    if (!block) continue;
    let m: RegExpMatchArray | null;
    if ((m = H1.exec(block))) { blocks.push({ type: 'heading', level: 1, text: m[1] }); continue; }
    if ((m = H2.exec(block))) { blocks.push({ type: 'heading', level: 2, text: m[1] }); continue; }
    if ((m = IMG.exec(block))) { blocks.push({ type: 'image', url: m[2], caption: m[1] || null }); continue; }
    if (RULE.test(block)) { blocks.push({ type: 'divider' }); continue; }
    if (block.split('\n').every((l) => BULLET_LINE.test(l))) {
      blocks.push({ type: 'bulleted_list', items: block.split('\n').map((l) => BULLET_LINE.exec(l)![1]) });
      continue;
    }
    if (block.split('\n').every((l) => NUMBERED_LINE.test(l))) {
      blocks.push({ type: 'numbered_list', items: block.split('\n').map((l) => NUMBERED_LINE.exec(l)![1]) });
      continue;
    }
    if (block.split('\n').every((l) => QUOTE.test(l))) {
      const inner = block.split('\n').map((l) => (QUOTE.exec(l) ?? ['', ''])[1]).join('\n');
      blocks.push({ type: 'quote', text: inner });
      continue;
    }
    blocks.push({ type: 'paragraph', text: block });
  }
  return blocks;
}

  const publish = async () => {
    if (busy || !profile?.id) return;
    if (!title.trim() || body.trim().length < 100) {
      Alert.alert('Almost', 'An article needs a title and at least a real opening - write a little more.');
      return;
    }
    setBusy(true);
    try {
      const aid = currentAuthorId(profile.id) ?? profile.id;
      let coverUrl: string | null = null;
      if (cover) {
        try { coverUrl = await feedService.uploadPostImage(aid, cover); } catch (e: any) {
          Alert.alert('Cover upload failed', e?.message || 'The article was not published. Try again or remove the cover.');
          setBusy(false);
          return;
        }
      }
      // One server call, one transaction: the post row and its cover post_media
      // row are created or fail together. No more silently-swallowed cover writes.
      const { data: newPostId, error } = await supabase.rpc('publish_article', {
        p_user_id: aid,
        p_title: title.trim(),
        p_body: body.trim(),
        p_read_minutes: minutes,
        p_cover_url: coverUrl,
        p_cover_width: coverDims?.width ?? null,
        p_cover_height: coverDims?.height ?? null,
        p_blocks: bodyToBlocks(body.trim()),
      });
      if (error) throw error;
      AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
      Alert.alert('Published', 'Your article is live in the feed.');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not publish', e?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
            <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Article</Text>
          <TouchableOpacity onPress={publish} disabled={busy} activeOpacity={0.8} style={{ width: 70, alignItems: 'flex-end' }}>
            {busy ? <ActivityIndicator color={NAVY} size={14} /> : <Text style={s.publish}>Publish</Text>}
          </TouchableOpacity>
        </View>
        <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(insets.bottom + 120, 140) }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor="#9CA3AF" multiline style={s.title} />
          <TouchableOpacity onPress={pickCover} activeOpacity={0.85} style={s.coverBtn}>
            {cover ? <Image source={{ uri: cover }} style={s.cover} /> : <Text style={s.coverTxt}>Add a cover image (optional)</Text>}
          </TouchableOpacity>
          <Text style={s.meta}>{minutes} min read {'\u00b7'} publishing as {profile?.full_name || 'you'}</Text>

          <View style={s.toolbar}>
            {([
              ['H', 'Heading', '# ', ''], ['h', 'Subheading', '## ', ''], ['B', 'Bold', '**', '**'], ['I', 'Italic', '_', '_'],
              ['\u201C', 'Quote', '> ', ''], ['\u2014', 'Divider', '\n---\n', ''],
              ['\u2022', 'Bullet list', '- ', ''], ['1.', 'Numbered list', '1. ', ''],
            ] as [string, string, string, string][]).map(([glyph, label, before, after]) => (
              <TouchableOpacity key={label} onPress={() => wrap(before, after)} style={s.toolBtn} activeOpacity={0.6}>
                <Text style={s.toolBtnTxt}>{glyph}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={openLinkModal} style={s.toolBtn} activeOpacity={0.6}>
              <Feather name="link" size={15} color="rgba(11,30,61,0.7)" />
            </TouchableOpacity>
            <TouchableOpacity onPress={insertImage} style={s.toolBtn} activeOpacity={0.6}>
              <Feather name="image" size={15} color="rgba(11,30,61,0.7)" />
            </TouchableOpacity>
            <Text style={s.wordCount}>{wordCount} words</Text>
            <TouchableOpacity onPress={() => setPreview((v: boolean) => !v)} style={[s.previewBtn, preview && s.previewBtnOn]} activeOpacity={0.75}>
              <Text style={[s.previewBtnTxt, preview && s.previewBtnTxtOn]}>{preview ? 'Edit' : 'Preview'}</Text>
            </TouchableOpacity>
          </View>

          <Modal visible={linkModalOpen} transparent animationType="fade" onRequestClose={() => setLinkModalOpen(false)}>
            <View style={s.linkModalOverlay}>
              <View style={s.linkModalCard}>
                <Text style={s.linkModalTitle}>Add a link</Text>
                <TextInput
                  value={linkText}
                  onChangeText={setLinkText}
                  placeholder="Link text"
                  placeholderTextColor="rgba(11,30,61,0.35)"
                  style={s.linkModalInput}
                />
                <TextInput
                  value={linkUrl}
                  onChangeText={setLinkUrl}
                  placeholder="https://"
                  placeholderTextColor="rgba(11,30,61,0.35)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={s.linkModalInput}
                />
                <View style={s.linkModalRow}>
                  <TouchableOpacity onPress={() => setLinkModalOpen(false)} style={s.linkModalCancel} activeOpacity={0.7}>
                    <Text style={s.linkModalCancelTxt}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={confirmLink} style={s.linkModalConfirm} activeOpacity={0.8}>
                    <Text style={s.linkModalConfirmTxt}>Insert</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {preview ? (
            <View style={s.previewWrap}>
              {body.trim() ? <ArticleBody text={body} /> : <Text style={s.previewEmpty}>Nothing to preview yet.</Text>}
            </View>
          ) : (
            <TextInput
              ref={bodyRef}
              value={body}
              onChangeText={setBody}
              onSelectionChange={(e: any) => setSelection(e.nativeEvent.selection)}
              placeholder="Write the piece. Paragraphs are preserved exactly as you write them. Use the toolbar for headings, emphasis, quotes, links and images."
              placeholderTextColor="#9CA3AF"
              multiline
              style={s.body}
              textAlignVertical="top"
            />
          )}

          {galleryImages.length > 0 && (
            <View style={s.galleryStrip}>
              {galleryImages.map((img: { url: string; width?: number; height?: number }, i: number) => (
                <View key={img.url + i} style={s.galleryThumbWrap}>
                  <Image source={{ uri: img.url }} style={s.galleryThumb} />
                  <TouchableOpacity
                    onPress={() => setGalleryImages((prev: { url: string; width?: number; height?: number }[]) => prev.filter((_: unknown, idx: number) => idx !== i))}
                    style={s.galleryRemove}
                    activeOpacity={0.7}
                  >
                    <Feather name="x" size={12} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 70 },
  backChev: { fontSize: 26, color: NAVY, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: NAVY, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: NAVY },
  publish: { fontSize: 15, fontWeight: '800', color: NAVY },
  title: { fontSize: 24, fontWeight: '800', color: NAVY, paddingVertical: 8, lineHeight: 30 },
  coverBtn: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.12)', borderRadius: 14, minHeight: 54, alignItems: 'center', justifyContent: 'center', marginBottom: 10, overflow: 'hidden' },
  cover: { width: '100%', height: 180 },
  coverTxt: { fontSize: 13, color: 'rgba(11,30,61,0.45)', fontWeight: '600', paddingVertical: 16 },
  meta: { fontSize: 12, color: 'rgba(11,30,61,0.45)', fontWeight: '600', marginBottom: 10 },
  body: { fontSize: 16, lineHeight: 25, color: NAVY, minHeight: 320, paddingBottom: 40 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2, borderWidth: 1, borderColor: 'rgba(11,30,61,0.1)', borderRadius: 12, paddingHorizontal: 6, paddingVertical: 5, marginBottom: 10 },
  toolBtn: { minWidth: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  toolBtnTxt: { fontSize: 14, fontWeight: '700', color: 'rgba(11,30,61,0.7)' },
  wordCount: { marginLeft: 'auto', fontSize: 11.5, color: 'rgba(11,30,61,0.4)', paddingHorizontal: 4 },
  previewBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#F2F3F5' },
  previewBtnOn: { backgroundColor: NAVY },
  previewBtnTxt: { fontSize: 12.5, fontWeight: '700', color: 'rgba(11,30,61,0.7)' },
  previewBtnTxtOn: { color: '#FFFFFF' },
  previewWrap: { minHeight: 320, paddingBottom: 40 },
  previewEmpty: { fontSize: 14, color: 'rgba(11,30,61,0.4)' },
  galleryStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  galleryThumbWrap: { width: 92, height: 92, borderRadius: 12, overflow: 'hidden', backgroundColor: '#F2F3F5' },
  galleryThumb: { width: '100%', height: '100%' },
  galleryRemove: { position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.65)', alignItems: 'center', justifyContent: 'center' },
  linkModalOverlay: { flex: 1, backgroundColor: 'rgba(11,30,61,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  linkModalCard: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18 },
  linkModalTitle: { fontSize: 16, fontWeight: '800', color: NAVY, marginBottom: 12 },
  linkModalInput: { backgroundColor: '#F2F3F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14.5, color: NAVY, marginBottom: 10 },
  linkModalRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  linkModalCancel: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center', backgroundColor: '#F2F3F5' },
  linkModalCancelTxt: { fontSize: 14, fontWeight: '700', color: 'rgba(11,30,61,0.6)' },
  linkModalConfirm: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center', backgroundColor: NAVY },
  linkModalConfirmTxt: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});