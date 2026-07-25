/**
 * CreateBusinessScreen
 *
 * Creates a business as its own profile, backed by a shadow auth user nobody
 * signs into. The caller becomes its owner.
 *
 * Username availability is checked as you type and again on the server, because
 * a client check is a race condition rather than a guarantee.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { light, typeSize, fontWeight, radius, space } from '../../constants/tokens';

const CATEGORIES = [
  'Retail', 'Food & Drink', 'Technology', 'Services', 'Health & Beauty',
  'Education', 'Transport', 'Construction', 'Agriculture', 'Finance',
  'Entertainment', 'Fashion', 'Property', 'Other',
];

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

export default function CreateBusinessScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability>('idle');
  const [creating, setCreating] = useState(false);
  const debounce = useRef<any>(null);

  const check = useCallback(async (value: string) => {
    const u = value.trim().toLowerCase();
    if (!u) { setAvail('idle'); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(u)) { setAvail('invalid'); return; }
    setAvail('checking');
    const { data, error } = await supabase.rpc('is_username_available', { p_username: u });
    if (error) { setAvail('idle'); return; }
    setAvail(data ? 'free' : 'taken');
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => check(username), 450);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [username, check]);

  const canCreate = name.trim().length >= 2 && avail === 'free' && !!category && !creating;

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    const { data, error } = await supabase.functions.invoke('create-business', {
      body: { name: name.trim(), username: username.trim().toLowerCase(), category },
    });
    setCreating(false);

    if (error) {
      // The function returns a JSON body with a readable reason on failure.
      let reason = error.message;
      try {
        const ctx: any = (error as any).context;
        if (ctx && typeof ctx.json === 'function') {
          const parsed = await ctx.json();
          if (parsed?.error) reason = parsed.error;
        }
      } catch { /* keep the original message */ }
      Alert.alert('Could not create the business', reason);
      return;
    }

    const biz = (data as any)?.business;
    Alert.alert(
      'Business created',
      `${biz?.name ?? name.trim()} is live. You can post as it, add your team, and fill in its details.`,
      [{ text: 'Done', onPress: () => navigation.goBack() }],
    );
  };

  const hint = () => {
    switch (avail) {
      case 'checking': return { txt: 'Checking...', color: light.ink.muted };
      case 'free':     return { txt: 'Available', color: light.status.success };
      case 'taken':    return { txt: 'Already taken', color: light.status.danger };
      case 'invalid':  return { txt: '3 to 30 characters. Lowercase letters, numbers, underscores.', color: light.ink.muted };
      default:         return { txt: 'This becomes the business @handle.', color: light.ink.faint };
    }
  };
  const h = hint();

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button" accessibilityLabel="Cancel"
        >
          <Feather name="chevron-left" size={26} color={light.ink.primary} />
        </TouchableOpacity>
        <Text style={s.title}>New business</Text>
        <TouchableOpacity onPress={create} disabled={!canCreate} style={[s.saveBtn, !canCreate && s.saveBtnOff]}>
          {creating ? <ActivityIndicator size="small" color={light.ink.inverse} /> : <Text style={s.saveTxt}>Create</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 48 }}
        >
          <Text style={s.lede}>
            A business gets its own profile, followers, posts and chats. You stay signed in as
            yourself and choose who to post as.
          </Text>

          <View style={s.field}>
            <Text style={s.label}>Business name</Text>
            <TextInput
              value={name} onChangeText={setName} style={s.input}
              placeholder="Pearl Group" placeholderTextColor={light.ink.faint}
              autoCapitalize="words"
            />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Username</Text>
            <View style={s.usernameRow}>
              <Text style={s.at}>@</Text>
              <TextInput
                value={username}
                onChangeText={v => setUsername(v.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                style={s.usernameInput}
                placeholder="pearlgroup" placeholderTextColor={light.ink.faint}
                autoCapitalize="none" autoCorrect={false}
              />
              {avail === 'checking' ? <ActivityIndicator size="small" color={light.ink.faint} /> : null}
              {avail === 'free' ? <Feather name="check" size={16} color={light.status.success} /> : null}
              {avail === 'taken' ? <Feather name="x" size={16} color={light.status.danger} /> : null}
            </View>
            <Text style={[s.hint, { color: h.color }]}>{h.txt}</Text>
          </View>

          <View style={s.field}>
            <Text style={s.label}>Category</Text>
            <View style={s.chips}>
              {CATEGORIES.map(c => {
                const on = category === c;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[s.chip, on && s.chipOn]}
                    onPress={() => setCategory(c)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[s.chipTxt, on && s.chipTxtOn]}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={s.note}>
            <Feather name="info" size={14} color={light.ink.muted} />
            <Text style={s.noteTxt}>
              Nobody signs in as a business. Access is managed by adding people to its team, so
              you never share a password.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const HAIR = StyleSheet.hairlineWidth;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: light.surface.canvas },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: space.sm,
    borderBottomWidth: HAIR, borderBottomColor: light.surface.hairline,
  },
  title: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },
  saveBtn: {
    minWidth: 68, alignItems: 'center',
    paddingHorizontal: space.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: light.brand.base,
  },
  saveBtnOff: { opacity: 0.4 },
  saveTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  lede: { fontSize: typeSize.body, color: light.ink.secondary, lineHeight: 20, marginBottom: space.lg },

  field: { marginBottom: space.lg, gap: 5 },
  label: {
    fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 1.1,
    textTransform: 'uppercase', color: light.ink.muted,
  },
  input: {
    borderWidth: HAIR, borderColor: light.surface.hairline, borderRadius: radius.md,
    paddingHorizontal: space.sm, paddingVertical: 11,
    fontSize: typeSize.body, color: light.ink.primary, backgroundColor: light.surface.raised,
  },
  usernameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: HAIR, borderColor: light.surface.hairline, borderRadius: radius.md,
    paddingHorizontal: space.sm, backgroundColor: light.surface.raised,
  },
  at: { fontSize: typeSize.body, color: light.ink.faint, fontWeight: fontWeight.semibold },
  usernameInput: { flex: 1, fontSize: typeSize.body, color: light.ink.primary, paddingVertical: 11 },
  hint: { fontSize: typeSize.micro, lineHeight: 15 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: 2 },
  chip: {
    paddingHorizontal: space.sm, paddingVertical: 7, borderRadius: radius.full,
    borderWidth: HAIR, borderColor: light.surface.hairline, backgroundColor: light.surface.canvas,
  },
  chipOn: { backgroundColor: light.brand.base, borderColor: light.brand.base },
  chipTxt: { fontSize: typeSize.caption, fontWeight: fontWeight.semibold, color: light.ink.secondary },
  chipTxtOn: { color: light.ink.inverse },

  note: {
    flexDirection: 'row', gap: space.xs, alignItems: 'flex-start',
    backgroundColor: light.surface.raised, borderRadius: radius.md, padding: space.sm,
    borderWidth: HAIR, borderColor: light.surface.hairline,
  },
  noteTxt: { flex: 1, fontSize: typeSize.micro, color: light.ink.muted, lineHeight: 16 },
});