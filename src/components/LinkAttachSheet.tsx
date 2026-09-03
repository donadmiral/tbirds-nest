/**
 * LinkAttachSheet
 *
 * Lets a post composer attach an external link (YouTube, TikTok, any
 * website). Fetches the page on-device, pulls Open Graph tags, and hands
 * the composer a preview to attach. This sheet only previews and confirms
 * -- the composer owns attaching the url to the post and, after the post
 * exists, calling cacheLinkPreview once to warm the shared cache.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, Image, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { fetchLinkPreview, normalizeUrl, deriveDomain, type LinkPreview } from '../services/linkPreview';

const NAVY = '#0B1E3D';

type Props = {
  visible: boolean;
  onClose: () => void;
  onAttach: (preview: LinkPreview) => void;
  initialUrl?: string | null;
  onRemove?: () => void;
};

export default function LinkAttachSheet({ visible, onClose, onAttach, initialUrl, onRemove }: Props) {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState(initialUrl || '');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [failed, setFailed] = useState(false);

  const reset = () => { setUrl(initialUrl || ''); setPreview(null); setFailed(false); setLoading(false); };
  const close = () => { reset(); onClose(); };

  const doPreview = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    setLoading(true);
    setFailed(false);
    const p = await fetchLinkPreview(trimmed);
    setLoading(false);
    setPreview(p);
    if (!p.title && !p.image_url) setFailed(true);
  };

  const attachPlain = () => {
    const u = normalizeUrl(url);
    setPreview({ url: u, title: null, description: null, image_url: null, domain: deriveDomain(u) });
  };

  const attach = () => {
    if (!preview) return;
    onAttach(preview);
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <TouchableOpacity style={sh.overlay} activeOpacity={1} onPress={close}>
        <TouchableOpacity activeOpacity={1} style={[sh.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={sh.handle} />
          <View style={sh.headerRow}>
            <TouchableOpacity onPress={close}><Text style={sh.cancelTxt}>Cancel</Text></TouchableOpacity>
            <Text style={sh.title}>Add a link</Text>
            <TouchableOpacity onPress={attach} disabled={!preview} style={[sh.doneBtn, !preview && { opacity: 0.35 }]}>
              <Text style={sh.doneTxt}>Attach</Text>
            </TouchableOpacity>
          </View>
          <View style={sh.inputRow}>
            <TextInput
              value={url}
              onChangeText={(t) => { setUrl(t); setPreview(null); setFailed(false); }}
              placeholder="Paste a YouTube, TikTok or website link"
              placeholderTextColor="rgba(11,30,61,0.35)"
              style={sh.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              keyboardAppearance="light"
              returnKeyType="go"
              onSubmitEditing={doPreview}
            />
            <TouchableOpacity onPress={doPreview} style={sh.previewBtn} disabled={!url.trim() || loading}>
              {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={sh.previewBtnTxt}>Preview</Text>}
            </TouchableOpacity>
          </View>
          {preview ? (
            <View style={sh.card}>
              {preview.image_url ? <Image source={{ uri: preview.image_url }} style={sh.cardImg} /> : null}
              <View style={sh.cardBody}>
                <Text style={sh.cardDomain} numberOfLines={1}>{preview.domain || ''}</Text>
                <Text style={sh.cardTitle} numberOfLines={2}>{preview.title || preview.url}</Text>
                {preview.description ? <Text style={sh.cardDesc} numberOfLines={2}>{preview.description}</Text> : null}
              </View>
            </View>
          ) : failed ? (
            <Text style={sh.hint}>Couldn't read a preview for that link. You can still attach it as a plain link.</Text>
          ) : (
            <Text style={sh.hint}>Paste a link and tap Preview.</Text>
          )}
          {failed && url.trim() ? (
            <TouchableOpacity onPress={attachPlain} style={sh.plainBtn}>
              <Text style={sh.plainBtnTxt}>Attach as plain link</Text>
            </TouchableOpacity>
          ) : null}
          {onRemove && initialUrl ? (
            <TouchableOpacity onPress={() => { onRemove(); reset(); onClose(); }} style={sh.removeBtn}>
              <Feather name="x-circle" size={15} color="#FF453A" />
              <Text style={sh.removeTxt}>Remove attached link</Text>
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const sh = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingHorizontal: 16 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(11,30,61,0.15)', alignSelf: 'center', marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  title: { fontSize: 16, fontWeight: '800', color: NAVY },
  cancelTxt: { fontSize: 15, color: 'rgba(11,30,61,0.55)' },
  doneBtn: { backgroundColor: NAVY, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 7 },
  doneTxt: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  input: { flex: 1, backgroundColor: '#F2F3F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14.5, color: NAVY },
  previewBtn: { backgroundColor: NAVY, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  previewBtnTxt: { fontSize: 13.5, fontWeight: '700', color: '#FFFFFF' },
  hint: { fontSize: 13, color: 'rgba(11,30,61,0.5)', marginTop: 14, marginBottom: 8, textAlign: 'center' },
  card: { flexDirection: 'row', marginTop: 14, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(11,30,61,0.1)', overflow: 'hidden' },
  cardImg: { width: 84, height: 84, backgroundColor: '#F2F3F5' },
  cardBody: { flex: 1, padding: 10, justifyContent: 'center' },
  cardDomain: { fontSize: 10.5, fontWeight: '700', color: 'rgba(11,30,61,0.45)', textTransform: 'uppercase', letterSpacing: 0.4 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: NAVY, marginTop: 2 },
  cardDesc: { fontSize: 12, color: 'rgba(11,30,61,0.55)', marginTop: 2 },
  plainBtn: { alignSelf: 'center', marginTop: 4, marginBottom: 8 },
  plainBtnTxt: { fontSize: 13, fontWeight: '700', color: NAVY, textDecorationLine: 'underline' },
  removeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16, paddingVertical: 10 },
  removeTxt: { fontSize: 13.5, fontWeight: '600', color: '#FF453A' },
});
