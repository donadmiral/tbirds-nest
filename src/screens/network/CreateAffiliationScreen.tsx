import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, StatusBar, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import {
  AffiliationKind, Affiliation,
  searchAffiliations, createAffiliation, getUserPrimaryInstitution,
} from '../../services/affiliationsService';

const KIND_OPTIONS: { value: AffiliationKind; label: string; icon: any }[] = [
  { value: 'club',          label: 'Club',          icon: 'star' },
  { value: 'organization',  label: 'Organization',  icon: 'briefcase' },
  { value: 'cohort',        label: 'Cohort',        icon: 'calendar' },
  { value: 'team',          label: 'Team',          icon: 'flag' },
  { value: 'honor_society', label: 'Honor Society', icon: 'award' },
  { value: 'fraternity',    label: 'Fraternity',    icon: 'users' },
  { value: 'sorority',      label: 'Sorority',      icon: 'users' },
  { value: 'other',         label: 'Other',         icon: 'globe' },
];

type Scope = 'school' | 'global';

export default function CreateAffiliationScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const prefillName: string = route.params?.prefillName || '';

  const [name, setName] = useState(prefillName);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<AffiliationKind>('club');
  const [scope, setScope] = useState<Scope>('school');
  const [primaryInst, setPrimaryInst] = useState<{ id: string; name: string } | null>(null);
  const [loadingInst, setLoadingInst] = useState(true);
  const [dupes, setDupes] = useState<Affiliation[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const inst = await getUserPrimaryInstitution(userId);
      if (!cancelled) {
        setPrimaryInst(inst);
        setLoadingInst(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Live duplicate check as user types the name
  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < 3) {
      setDupes([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const data = await searchAffiliations(trimmed, userId);
      if (!cancelled) setDupes(data.slice(0, 4));
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [name, userId]);

  const canCreate = useMemo(() =>
    name.trim().length >= 2 && !creating && !loadingInst,
  [name, creating, loadingInst]);

  const handleCreate = async () => {
    if (!userId || !canCreate) return;
    setCreating(true);
    try {
      const institutionId = scope === 'school' ? (primaryInst?.id || null) : null;
      await createAffiliation({
        name: name.trim(),
        kind,
        description: description.trim() || null,
        institutionId,
        userId,
      });
      navigation.goBack();
    } catch (e: any) {
      console.log('[CreateAffiliation error]', e);
      const msg = e?.message || '';
      if (msg.toLowerCase().includes('duplicate') || msg.includes('unique')) {
        Alert.alert('Already exists', 'An affiliation with this name and scope already exists. Try the search tab to find it.');
      } else {
        Alert.alert('Error', msg || 'Could not create.');
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Feather name="chevron-left" size={26} color="#000" />
          </TouchableOpacity>
          <Text style={s.title}>Create community</Text>
          <TouchableOpacity
            style={[s.createBtn, !canCreate && s.createBtnOff]}
            onPress={handleCreate}
            disabled={!canCreate}
            activeOpacity={0.8}
          >
            {creating ? (
              <ActivityIndicator color="#FFF" size={14} />
            ) : (
              <Text style={s.createBtnTxt}>Create</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 18 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.field}>
            <Text style={s.label}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Thunderbird Consulting Club"
              placeholderTextColor="#9CA3AF"
              style={s.input}
              maxLength={80}
              autoFocus
            />
          </View>

          {dupes.length > 0 && (
            <View style={s.dupesCard}>
              <View style={s.dupesHead}>
                <Feather name="alert-circle" size={14} color="#B45309" />
                <Text style={s.dupesHeadTxt}>Similar communities exist</Text>
              </View>
              <Text style={s.dupesSub}>Join one of these instead to avoid duplicates.</Text>
              {dupes.map(d => (
                <TouchableOpacity
                  key={d.id}
                  style={s.dupeRow}
                  onPress={() => {
                    navigation.goBack();
                  }}
                  activeOpacity={0.7}
                >
                  <Feather name="users" size={14} color="#6B7280" />
                  <View style={{ flex: 1 }}>
                    <Text style={s.dupeName} numberOfLines={1}>{d.name}</Text>
                    <Text style={s.dupeMeta}>
                      {d.member_count} {d.member_count === 1 ? 'member' : 'members'}
                      {d.institution_id ? ' · School' : ' · Global'}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={s.field}>
            <Text style={s.label}>Type</Text>
            <View style={s.kindGrid}>
              {KIND_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.kindChip, kind === opt.value && s.kindChipActive]}
                  onPress={() => setKind(opt.value)}
                  activeOpacity={0.8}
                >
                  <Feather name={opt.icon} size={13} color={kind === opt.value ? '#FFF' : '#374151'} />
                  <Text style={[s.kindChipTxt, kind === opt.value && s.kindChipTxtActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.field}>
            <Text style={s.label}>Scope</Text>
            <Text style={s.help}>Who can see and join this community.</Text>
            <View style={s.scopeRow}>
              <TouchableOpacity
                style={[s.scopeCard, scope === 'school' && s.scopeCardActive]}
                onPress={() => setScope('school')}
                activeOpacity={0.8}
              >
                <Feather name="award" size={16} color={scope === 'school' ? '#1D4ED8' : '#6B7280'} />
                <Text style={[s.scopeTitle, scope === 'school' && s.scopeTitleActive]}>
                  My school
                </Text>
                <Text style={s.scopeDesc} numberOfLines={2}>
                  {primaryInst?.name || 'Your primary institution'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.scopeCard, scope === 'global' && s.scopeCardActive]}
                onPress={() => setScope('global')}
                activeOpacity={0.8}
              >
                <Feather name="globe" size={16} color={scope === 'global' ? '#059669' : '#6B7280'} />
                <Text style={[s.scopeTitle, scope === 'global' && s.scopeTitleActive]}>
                  Global
                </Text>
                <Text style={s.scopeDesc} numberOfLines={2}>
                  Open to all schools
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.field}>
            <Text style={s.label}>Description <Text style={s.optional}>(optional)</Text></Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What's this community about?"
              placeholderTextColor="#9CA3AF"
              style={[s.input, s.inputMulti]}
              multiline
              maxLength={500}
              textAlignVertical="top"
            />
            <Text style={s.counter}>{description.length}/500</Text>
          </View>

          <View style={s.noteCard}>
            <Feather name="info" size={14} color="#6B7280" />
            <Text style={s.noteTxt}>
              You'll become the founder. You can invite members and manage the community from your profile.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#000', flex: 1 },
  createBtn: {
    backgroundColor: '#000', borderRadius: 12,
    paddingHorizontal: 18, paddingVertical: 9,
    minWidth: 78, alignItems: 'center',
  },
  createBtnOff: { opacity: 0.35 },
  createBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700', color: '#111' },
  help: { fontSize: 12, color: '#6B7280' },
  optional: { fontWeight: '500', color: '#9CA3AF' },

  input: {
    backgroundColor: '#F5F5F5', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#000',
  },
  inputMulti: { minHeight: 90 },
  counter: { fontSize: 11, color: '#9CA3AF', textAlign: 'right', marginTop: 4 },

  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, backgroundColor: '#F3F4F6',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB',
  },
  kindChipActive: { backgroundColor: '#000', borderColor: '#000' },
  kindChipTxt: { fontSize: 13, fontWeight: '600', color: '#374151' },
  kindChipTxtActive: { color: '#FFF' },

  scopeRow: { flexDirection: 'row', gap: 10 },
  scopeCard: {
    flex: 1, gap: 4,
    backgroundColor: '#F5F5F5', borderRadius: 14,
    padding: 14,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  scopeCardActive: { borderColor: '#000', backgroundColor: '#FFF' },
  scopeTitle: { fontSize: 14, fontWeight: '700', color: '#111', marginTop: 4 },
  scopeTitleActive: { color: '#000' },
  scopeDesc: { fontSize: 11, color: '#6B7280', lineHeight: 15 },

  dupesCard: {
    backgroundColor: '#FFFBEB', borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#FDE68A',
    gap: 8,
  },
  dupesHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dupesHeadTxt: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  dupesSub: { fontSize: 12, color: '#B45309', marginBottom: 4 },
  dupeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFF', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  dupeName: { fontSize: 13, fontWeight: '600', color: '#111' },
  dupeMeta: { fontSize: 11, color: '#8E8E93', marginTop: 1 },

  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12,
  },
  noteTxt: { flex: 1, fontSize: 12, color: '#6B7280', lineHeight: 17 },
});