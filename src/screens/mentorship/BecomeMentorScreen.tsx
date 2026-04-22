import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Alert, StatusBar, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import {
  getMyMentorProfile, upsertMentorProfile,
  MyMentorProfile, MentorKind, MENTOR_KIND_LABEL, HELP_WITH_OPTIONS,
} from '../../services/mentorshipService';

const KIND_OPTIONS: Array<{ id: MentorKind; desc: string }> = [
  { id: 'alumni',         desc: "You've graduated from your school" },
  { id: 'faculty',        desc: 'Teaching or research faculty' },
  { id: 'staff',          desc: 'Staff member at the institution' },
  { id: 'student_mentor', desc: 'Current student, second-year and above' },
];

const CAPACITY_OPTIONS = [1, 2, 3, 4, 5];

export default function BecomeMentorScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<MyMentorProfile | null>(null);

  const [isActive, setIsActive] = useState(true);
  const [mentorKind, setMentorKind] = useState<MentorKind>('alumni');
  const [bio, setBio] = useState('');
  const [availabilityNote, setAvailabilityNote] = useState('');
  const [helpWith, setHelpWith] = useState<string[]>([]);
  const [expertiseInput, setExpertiseInput] = useState('');
  const [expertise, setExpertise] = useState<string[]>([]);
  const [capacity, setCapacity] = useState<number>(3);

  const load = useCallback(async () => {
    const data = await getMyMentorProfile();
    if (data) {
      setExisting(data);
      setIsActive(data.is_active);
      setMentorKind(data.mentor_kind);
      setBio(data.bio || '');
      setAvailabilityNote(data.availability_note || '');
      setHelpWith(data.help_with || []);
      setExpertise(data.expertise_tags || []);
      setCapacity(data.max_active_mentees);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleHelp = (opt: string) => {
    setHelpWith(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt]);
  };

  const addExpertise = () => {
    const v = expertiseInput.trim();
    if (!v) return;
    if (expertise.includes(v)) { setExpertiseInput(''); return; }
    if (expertise.length >= 10) {
      Alert.alert('Limit reached', 'You can add up to 10 expertise tags.');
      return;
    }
    setExpertise(prev => [...prev, v]);
    setExpertiseInput('');
  };

  const removeExpertise = (tag: string) => {
    setExpertise(prev => prev.filter(t => t !== tag));
  };

  const save = async () => {
    if (saving) return;
    if (!bio.trim() || bio.trim().length < 40) {
      Alert.alert('Add a bio', 'Please write at least 40 characters so mentees can understand who you are.');
      return;
    }
    if (helpWith.length === 0) {
      Alert.alert('Pick at least one', 'Select what you can help mentees with.');
      return;
    }
    setSaving(true);
    try {
      await upsertMentorProfile({
        bio: bio.trim(),
        expertiseTags: expertise,
        helpWith,
        availabilityNote: availabilityNote.trim(),
        maxActiveMentees: capacity,
        mentorKind,
        isActive,
      });
      Alert.alert(
        isActive ? 'You\'re a mentor!' : 'Saved',
        isActive
          ? 'Students at your school can now see your profile and request mentorship.'
          : 'Your profile is hidden from the directory. You can reactivate anytime.',
        [{ text: 'OK', onPress: () => nav.goBack() }]
      );
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loader}><ActivityIndicator color="#000" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        <View style={s.header}>
          <TouchableOpacity onPress={() => nav.goBack()} style={s.backBtn}>
            <Feather name="chevron-left" size={26} color="#000" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{existing ? 'Mentor profile' : 'Become a mentor'}</Text>
          <TouchableOpacity onPress={save} disabled={saving} style={s.saveBtn}>
            {saving ? <ActivityIndicator color="#007AFF" size={16} /> : <Text style={s.saveTxt}>Save</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">

          {!existing && (
            <View style={s.intro}>
              <Text style={s.introTitle}>Help someone grow</Text>
              <Text style={s.introTxt}>
                Mentors at your school offer real career guidance, not just networking. You set your own cap and end relationships anytime.
              </Text>
            </View>
          )}

          {existing && (
            <View style={s.activeRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.activeTitle}>Accepting mentees</Text>
                <Text style={s.activeSub}>
                  {isActive ? 'Your profile is visible in the directory' : 'Hidden from the directory'}
                </Text>
              </View>
              <Switch value={isActive} onValueChange={setIsActive} />
            </View>
          )}

          <Text style={s.sectionLabel}>I AM A</Text>
          <View style={s.kindList}>
            {KIND_OPTIONS.map(k => {
              const selected = mentorKind === k.id;
              return (
                <TouchableOpacity
                  key={k.id}
                  style={[s.kindCard, selected && s.kindCardSel]}
                  onPress={() => setMentorKind(k.id)}
                  activeOpacity={0.8}
                >
                  <View style={[s.radio, selected && s.radioSel]}>
                    {selected && <View style={s.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.kindTitle, selected && { color: '#000' }]}>{MENTOR_KIND_LABEL[k.id]}</Text>
                    <Text style={s.kindDesc}>{k.desc}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.sectionLabel}>ABOUT YOU</Text>
          <TextInput
            value={bio}
            onChangeText={t => t.length <= 600 && setBio(t)}
            placeholder="Share your background, journey, and why you want to mentor. 40 characters minimum."
            placeholderTextColor="#9CA3AF"
            style={[s.input, { minHeight: 120 }]}
            multiline
            textAlignVertical="top"
          />
          <Text style={s.charHint}>{bio.length}/600</Text>

          <Text style={s.sectionLabel}>WHAT YOU CAN HELP WITH</Text>
          <View style={s.tagGrid}>
            {HELP_WITH_OPTIONS.map(opt => {
              const on = helpWith.includes(opt);
              return (
                <TouchableOpacity
                  key={opt}
                  style={[s.tag, on && s.tagOn]}
                  onPress={() => toggleHelp(opt)}
                  activeOpacity={0.75}
                >
                  {on && <Feather name="check" size={11} color="#FFF" />}
                  <Text style={[s.tagTxt, on && s.tagTxtOn]}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.sectionLabel}>EXPERTISE TAGS</Text>
          <Text style={s.helperTxt}>
            Add specific topics like "investment banking", "early-stage startups", or "Zimbabwe market".
          </Text>
          <View style={s.expertiseInputRow}>
            <TextInput
              value={expertiseInput}
              onChangeText={setExpertiseInput}
              placeholder="Add a tag"
              placeholderTextColor="#9CA3AF"
              style={s.expertiseInput}
              onSubmitEditing={addExpertise}
              returnKeyType="done"
              maxLength={40}
            />
            <TouchableOpacity style={s.addBtn} onPress={addExpertise}>
              <Feather name="plus" size={16} color="#FFF" />
            </TouchableOpacity>
          </View>
          {expertise.length > 0 && (
            <View style={s.expertiseList}>
              {expertise.map(t => (
                <TouchableOpacity key={t} style={s.expertiseTag} onPress={() => removeExpertise(t)}>
                  <Text style={s.expertiseTagTxt}>{t}</Text>
                  <Feather name="x" size={11} color="#6B7280" />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={s.sectionLabel}>CAPACITY</Text>
          <Text style={s.helperTxt}>Maximum active mentees at one time.</Text>
          <View style={s.capRow}>
            {CAPACITY_OPTIONS.map(n => {
              const sel = capacity === n;
              return (
                <TouchableOpacity
                  key={n}
                  style={[s.capBtn, sel && s.capBtnSel]}
                  onPress={() => setCapacity(n)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.capNum, sel && s.capNumSel]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.sectionLabel}>AVAILABILITY (OPTIONAL)</Text>
          <TextInput
            value={availabilityNote}
            onChangeText={t => t.length <= 200 && setAvailabilityNote(t)}
            placeholder="Example: 1-2 sessions per month, evenings only"
            placeholderTextColor="#9CA3AF"
            style={s.input}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  saveBtn: { width: 56, height: 40, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { fontSize: 15, fontWeight: '700', color: '#007AFF' },

  intro: { paddingVertical: 14, paddingHorizontal: 4, marginBottom: 4 },
  introTitle: { fontSize: 22, fontWeight: '800', color: '#000' },
  introTxt: { fontSize: 14, color: '#6B7280', marginTop: 6, lineHeight: 20 },

  activeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 6, marginTop: 4,
  },
  activeTitle: { fontSize: 14, fontWeight: '700', color: '#000' },
  activeSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: '#8E8E93',
    letterSpacing: 0.7, marginTop: 22, marginBottom: 10,
  },
  helperTxt: { fontSize: 12, color: '#6B7280', marginBottom: 10, marginTop: -4, lineHeight: 16 },

  kindList: { gap: 8 },
  kindCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F9FAFB', borderRadius: 12,
    padding: 12,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  kindCardSel: { backgroundColor: '#FFF', borderColor: '#000' },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#D1D5DB',
    alignItems: 'center', justifyContent: 'center',
  },
  radioSel: { borderColor: '#000' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#000' },
  kindTitle: { fontSize: 14, fontWeight: '700', color: '#374151' },
  kindDesc: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  input: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    fontSize: 14, color: '#111', lineHeight: 20,
  },
  charHint: { fontSize: 11, color: '#9CA3AF', textAlign: 'right', marginTop: 4 },

  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1, borderColor: 'transparent',
  },
  tagOn: { backgroundColor: '#000', borderColor: '#000' },
  tagTxt: { fontSize: 13, fontWeight: '600', color: '#374151' },
  tagTxtOn: { color: '#FFF' },

  expertiseInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  expertiseInput: {
    flex: 1, backgroundColor: '#F9FAFB',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: '#111',
  },
  addBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
  },
  expertiseList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  expertiseTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  expertiseTagTxt: { fontSize: 12, color: '#374151', fontWeight: '600' },

  capRow: { flexDirection: 'row', gap: 8 },
  capBtn: {
    flex: 1, height: 48, borderRadius: 12,
    backgroundColor: '#F9FAFB',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'transparent',
  },
  capBtnSel: { backgroundColor: '#FFF', borderColor: '#000' },
  capNum: { fontSize: 18, fontWeight: '800', color: '#6B7280' },
  capNumSel: { color: '#000' },
});