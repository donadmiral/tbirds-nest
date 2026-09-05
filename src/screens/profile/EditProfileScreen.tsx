/**
 * EditProfileScreen
 *
 * Replaces the modal buried inside ProfileScreen. That modal had five fields and
 * no way to set a banner, even though the profile renders one.
 *
 * Writes to `headline` rather than `degree_program`. The old modal labelled
 * degree_program as "Profession", which is a school column doing a job it was
 * not designed for. headline is the correct field and the one the header shows.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Switch, KeyboardAvoidingView, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../services/supabase';
import { uploadMedia } from '../../services/mediaService';
import { useAuthStore } from '../../stores/authStore';
import { light, typeSize, fontWeight, radius, space } from '../../constants/tokens';

type Draft = {
  full_name: string;
  username: string;
  headline: string;
  bio: string;
  workplace: string;
  location: string;
  isPrivate: boolean;
  avatar_url: string | null;
  banner_url: string | null;
  links: { title: string; url: string }[];
};

const EMPTY: Draft = {
  full_name: '', username: '', headline: '', bio: '',
  workplace: '', location: '', isPrivate: false,
  avatar_url: null, banner_url: null,
  links: [],
};

const normalizeUrl = (u: string) => { const t = u.trim(); if (!t) return ''; return /^https?:\/\//i.test(t) ? t : 'https://' + t; };

export default function EditProfileScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile: authProfile, setProfile: setAuthProfile } = useAuthStore();
  const userId = (authProfile as any)?.id ?? null;

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyImage, setBusyImage] = useState<'avatar' | 'banner' | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!userId) { setLoading(false); return; }
      const { data, error: err } = await supabase
        .from('profiles')
        .select('full_name, username, headline, bio, workplace, location, profile_visibility, avatar_url, banner_url, links')
        .eq('id', userId)
        .single();
      if (!alive) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setDraft({
        full_name: data.full_name || '',
        username: data.username || '',
        headline: data.headline || '',
        bio: data.bio || '',
        workplace: data.workplace || '',
        location: data.location || '',
        links: Array.isArray((data as any).links) ? ((data as any).links as any[]).filter(l => l && l.url).map(l => ({ title: String(l.title || ''), url: String(l.url || '') })) : [],
        isPrivate: (data.profile_visibility || 'public') === 'private',
        avatar_url: data.avatar_url || null,
        banner_url: data.banner_url || null,
      });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));
  const setLink = (i: number, k: 'title' | 'url', v: string) => setDraft(d => ({ ...d, links: d.links.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const addLink = () => setDraft(d => (d.links.length >= 5 ? d : { ...d, links: [...d.links, { title: '', url: '' }] }));
  const removeLink = (i: number) => setDraft(d => ({ ...d, links: d.links.filter((_, j) => j !== i) }));

  const pickImage = async (kind: 'avatar' | 'banner') => {
    if (!userId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access in your device settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
        preferredAssetRepresentationMode: "compatible" as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
      mediaTypes: ['images'] as ImagePicker.MediaType[],
      allowsEditing: true,
      aspect: kind === 'avatar' ? [1, 1] : [3, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setBusyImage(kind);
    try {
      const asset = result.assets[0];
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase().replace('jpeg', 'jpg');
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      const { url } = await uploadMedia(
        'avatars', userId,
        { uri: asset.uri, kind: 'image', ext, mimeType: mime, width: asset.width, height: asset.height, base64: null },
        { filename: `${kind}_${Date.now()}.${ext}` },
      );
      set(kind === 'avatar' ? 'avatar_url' : 'banner_url', url);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload the image.');
    } finally {
      setBusyImage(null);
    }
  };

  const save = async () => {
    if (!userId || saving) return;
    if (!draft.full_name.trim()) { Alert.alert('Required', 'Full name cannot be empty.'); return; }
    setSaving(true);
    const { error: err } = await supabase.from('profiles').update({
      full_name: draft.full_name.trim(),
      username: draft.username.trim().toLowerCase().replace(/\s+/g, '_') || null,
      headline: draft.headline.trim() || null,
      bio: draft.bio.trim() || null,
      workplace: draft.workplace.trim() || null,
      location: draft.location.trim() || null,
      links: draft.links.filter(l => l.url.trim()).slice(0, 5).map(l => ({ title: l.title.trim(), url: normalizeUrl(l.url) })),
      profile_visibility: draft.isPrivate ? 'private' : 'public',
      avatar_url: draft.avatar_url,
      banner_url: draft.banner_url,
      updated_at: new Date().toISOString(),
    }).eq('id', userId);
    setSaving(false);
    if (err) {
      Alert.alert(
        err.message.includes('duplicate') ? 'Username taken' : 'Could not save',
        err.message.includes('duplicate') ? 'That username is already in use. Try another.' : err.message,
      );
      return;
    }
    if (setAuthProfile) {
      setAuthProfile({ ...(authProfile as any), full_name: draft.full_name.trim(), avatar_url: draft.avatar_url });
    }
    navigation.goBack();
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <View style={s.centered}><ActivityIndicator color={light.brand.base} /></View>
      </SafeAreaView>
    );
  }

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
        <Text style={s.title}>Edit profile</Text>
        <TouchableOpacity onPress={save} disabled={saving} style={[s.saveBtn, saving && s.saveBtnOff]}>
          {saving ? <ActivityIndicator size="small" color={light.ink.inverse} /> : <Text style={s.saveTxt}>Save</Text>}
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={s.banner}><Text style={s.bannerTxt}>{error}</Text></View>
      ) : null}

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
        >
          <TouchableOpacity style={s.bannerPick} activeOpacity={0.85} onPress={() => pickImage('banner')}>
            {draft.banner_url ? (
              <ExpoImage source={{ uri: draft.banner_url }} style={s.bannerImg} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={[s.bannerImg, s.bannerEmpty]} />
            )}
            <View style={s.bannerOverlay}>
              {busyImage === 'banner'
                ? <ActivityIndicator color={light.ink.inverse} />
                : <><Feather name="camera" size={16} color={light.ink.inverse} /><Text style={s.overlayTxt}>Change banner</Text></>}
            </View>
          </TouchableOpacity>

          <View style={s.avatarRow}>
            <TouchableOpacity onPress={() => pickImage('avatar')} activeOpacity={0.85}>
              {busyImage === 'avatar' ? (
                <View style={[s.avatar, s.avatarBusy]}><ActivityIndicator color={light.brand.base} /></View>
              ) : draft.avatar_url ? (
                <ExpoImage source={{ uri: draft.avatar_url }} style={s.avatar} contentFit="cover" cachePolicy="memory-disk" />
              ) : (
                <View style={[s.avatar, s.avatarEmpty]}><Feather name="user" size={26} color={light.ink.faint} /></View>
              )}
              <View style={s.avatarBadge}><Feather name="camera" size={11} color={light.ink.inverse} /></View>
            </TouchableOpacity>
            <Text style={s.avatarHint}>Tap either image to change it</Text>
          </View>

          <View style={s.form}>
            <Field label="Full name" required>
              <TextInput value={draft.full_name} onChangeText={v => set('full_name', v)} style={s.input}
                placeholder="Your full name" placeholderTextColor={light.ink.faint} autoCapitalize="words" />
            </Field>

            <Field label="Username" hint="Letters, numbers and underscores. This is your @handle.">
              <TextInput value={draft.username} onChangeText={v => set('username', v)} style={s.input}
                placeholder="username" placeholderTextColor={light.ink.faint} autoCapitalize="none" autoCorrect={false} />
            </Field>

            <Field label="Headline" hint="What you do, in one line.">
              <TextInput value={draft.headline} onChangeText={v => set('headline', v)} style={s.input}
                placeholder="e.g. Software developer, Trader, Nurse" placeholderTextColor={light.ink.faint} />
            </Field>

            <Field label="Bio">
              <TextInput value={draft.bio} onChangeText={v => set('bio', v)} style={[s.input, s.inputMulti]}
                placeholder="Tell people about yourself" placeholderTextColor={light.ink.faint}
                multiline textAlignVertical="top" maxLength={280} />
              <Text style={s.counter}>{draft.bio.length}/280</Text>
            </Field>

            <Field label="Workplace">
              <TextInput value={draft.workplace} onChangeText={v => set('workplace', v)} style={s.input}
                placeholder="Where you work" placeholderTextColor={light.ink.faint} />
            </Field>

            <Field label="Location">
              <TextInput value={draft.location} onChangeText={v => set('location', v)} style={s.input}
                placeholder="City, Country" placeholderTextColor={light.ink.faint} autoCapitalize="words" />
            </Field>

            <Field label="Links">
              <Text style={s.toggleHint}>Up to five. They show as buttons under your bio.</Text>
              {draft.links.map((l, i) => (
                <View key={i} style={{ marginTop: 8, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TextInput value={l.title} onChangeText={v => setLink(i, 'title', v)} style={[s.input, { flex: 1 }]}
                      placeholder="Label, e.g. My shop" placeholderTextColor={light.ink.faint} />
                    <TouchableOpacity onPress={() => removeLink(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Remove link">
                      <Feather name="x" size={18} color={light.ink.muted} />
                    </TouchableOpacity>
                  </View>
                  <TextInput value={l.url} onChangeText={v => setLink(i, 'url', v)} style={s.input}
                    placeholder="https://" placeholderTextColor={light.ink.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
                </View>
              ))}
              {draft.links.length < 5 ? (
                <TouchableOpacity onPress={addLink} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }} activeOpacity={0.8}>
                  <Feather name="plus" size={16} color={light.brand.base} />
                  <Text style={{ fontSize: 14, fontWeight: '600', color: light.brand.base }}>Add a link</Text>
                </TouchableOpacity>
              ) : null}
            </Field>

            <View style={s.toggleRow}>
              <View style={s.toggleText}>
                <Text style={s.toggleLbl}>Private account</Text>
                <Text style={s.toggleHint}>
                  Only approved followers can see your posts. New followers have to request first.
                </Text>
              </View>
              <Switch
                value={draft.isPrivate}
                onValueChange={v => set('isPrivate', v)}
                trackColor={{ true: light.brand.base, false: light.surface.hairline }}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, hint, required, children }: any) {
  return (
    <View style={s.field}>
      <Text style={s.label}>
        {label}{required ? <Text style={s.req}> *</Text> : null}
      </Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: light.surface.canvas },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: light.surface.hairline,
  },
  title: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },
  saveBtn: {
    minWidth: 62, alignItems: 'center',
    paddingHorizontal: space.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: light.brand.base,
  },
  saveBtnOff: { opacity: 0.6 },
  saveTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  banner: { backgroundColor: light.status.dangerBg, paddingHorizontal: 14, paddingVertical: space.sm },
  bannerTxt: { fontSize: typeSize.caption, color: light.status.danger, fontWeight: fontWeight.semibold },

  bannerPick: { height: 132, backgroundColor: light.brand.base },
  bannerImg: { width: '100%', height: '100%' },
  bannerEmpty: { backgroundColor: light.brand.base },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 6,
    backgroundColor: 'rgba(11,30,61,0.34)',
  },
  overlayTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 14, marginTop: -30 },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 2.5, borderColor: light.surface.canvas, backgroundColor: light.surface.sunken },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  avatarBusy: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.surface.canvas },
  avatarBadge: {
    position: 'absolute', right: 0, bottom: 2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: light.brand.base,
    borderWidth: 2, borderColor: light.surface.canvas,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarHint: { flex: 1, fontSize: typeSize.micro, color: light.ink.muted, marginTop: 30 },

  form: { paddingHorizontal: 14, paddingTop: space.md, gap: space.md },
  field: { gap: 5 },
  label: { fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 1.1, textTransform: 'uppercase', color: light.ink.muted },
  req: { color: light.status.danger },
  hint: { fontSize: typeSize.micro, color: light.ink.faint, lineHeight: 15 },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: light.surface.hairline,
    borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: 11,
    fontSize: typeSize.body, color: light.ink.primary, backgroundColor: light.surface.raised,
  },
  inputMulti: { minHeight: 96, paddingTop: 11 },
  counter: { alignSelf: 'flex-end', fontSize: typeSize.micro, color: light.ink.faint },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: space.sm, marginTop: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: light.surface.hairline,
  },
  toggleText: { flex: 1 },
  toggleLbl: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: light.ink.primary },
  toggleHint: { fontSize: typeSize.micro, color: light.ink.muted, marginTop: 2, lineHeight: 15 },
});