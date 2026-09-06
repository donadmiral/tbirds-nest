/**
 * Hidden words: comments on your posts that contain any of these are hidden
 * the moment they're written, on the server. Instagram's feature, same name.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StatusBar, Alert, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { themedSheet, useTheme } from '../../theme/useTheme';

export default function HiddenWordsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const { profile } = useAuthStore();
  const [words, setWords] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    supabase.from('profiles').select('hidden_words').eq('id', profile.id).maybeSingle().then(({ data }) => setWords(((data as any)?.hidden_words as string[]) || []));
  }, [profile?.id]);

  const save = async (next: string[]) => {
    if (!profile?.id) return;
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ hidden_words: next }).eq('id', profile.id);
    setBusy(false);
    if (error) { Alert.alert('Not saved', error.message); return; }
    setWords(next);
  };
  const add = () => { const w = draft.trim().toLowerCase(); if (!w) return; if (words.includes(w)) { setDraft(''); return; } save([...words, w]); setDraft(''); };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="chevron-left" size={26} color={t.ink.primary} /></TouchableOpacity>
        <Text style={s.title}>Hidden words</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={s.lede}>Comments on your posts that contain any of these words or phrases are hidden as soon as they're written. Only the person who wrote one can see it.</Text>
        <View style={s.row}>
          <TextInput value={draft} onChangeText={setDraft} placeholder="Add a word or phrase" placeholderTextColor={t.ink.faint} autoCapitalize="none" style={s.input} onSubmitEditing={add} returnKeyType="done" />
          <TouchableOpacity style={s.addBtn} onPress={add} disabled={busy} activeOpacity={0.85}><Text style={s.addTxt}>Add</Text></TouchableOpacity>
        </View>
        {words.map((w) => (
          <View key={w} style={s.word}>
            <Text style={s.wordTxt}>{w}</Text>
            <TouchableOpacity onPress={() => save(words.filter((x) => x !== w))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="x" size={16} color={t.ink.muted} /></TouchableOpacity>
          </View>
        ))}
        {words.length === 0 ? <Text style={s.empty}>Nothing hidden yet.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: t.ink.primary },
  lede: { fontSize: 13.5, lineHeight: 19, color: t.ink.muted, marginBottom: 14 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  input: { flex: 1, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 12, paddingHorizontal: 12, height: 44, fontSize: 15, color: t.ink.primary, backgroundColor: t.surface.raised },
  addBtn: { backgroundColor: t.brand.base, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
  addTxt: { color: t.ink.inverse, fontWeight: '800', fontSize: 14 },
  word: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  wordTxt: { fontSize: 15, color: t.ink.primary, fontWeight: '600' },
  empty: { fontSize: 13.5, color: t.ink.muted, marginTop: 10 },
}));