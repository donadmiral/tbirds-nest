import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { requestMentorship, HELP_WITH_OPTIONS } from '../../services/mentorshipService';

const MIN_CHARS = 100;
const MAX_CHARS = 600;

type Props = {
  mentorId: string;
  mentorName: string;
  helpWithOptions: string[];
  onClose: () => void;
  onSuccess: () => void;
};

export default function RequestMentorshipModal({
  mentorId, mentorName, helpWithOptions, onClose, onSuccess,
}: Props) {
  const [message, setMessage] = useState('');
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Mentor's own tags come first. Fill with defaults if fewer than 5.
  const options = Array.from(new Set([...helpWithOptions, ...HELP_WITH_OPTIONS])).slice(0, 10);

  const toggleFocus = (tag: string) => {
    setFocusAreas(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const submit = async () => {
    if (submitting) return;
    if (message.trim().length < MIN_CHARS) {
      Alert.alert('A bit more', `Please write at least ${MIN_CHARS} characters so your mentor understands your goals.`);
      return;
    }
    setSubmitting(true);
    try {
      await requestMentorship({
        mentorId,
        message: message.trim(),
        focusAreas,
      });
      Alert.alert('Request sent', `${mentorName} will review your request and respond soon.`, [
        { text: 'OK', onPress: onSuccess },
      ]);
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const remaining = MAX_CHARS - message.length;
  const charsOk = message.trim().length >= MIN_CHARS;

  return (
    <Pressable style={s.backdrop} onPress={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable onPress={() => {}}>
          <View style={s.sheet}>
            <View style={s.handle} />
            <View style={s.header}>
              <TouchableOpacity onPress={onClose}>
                <Text style={s.cancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.title} numberOfLines={1}>Request {mentorName.split(' ')[0]}</Text>
              <TouchableOpacity onPress={submit} disabled={submitting || !charsOk}>
                {submitting ? (
                  <ActivityIndicator color="#007AFF" size={16} />
                ) : (
                  <Text style={[s.send, !charsOk && { opacity: 0.35 }]}>Send</Text>
                )}
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              <Text style={s.sectionLabel}>WHAT DO YOU NEED HELP WITH?</Text>
              <View style={s.tagGrid}>
                {options.map(opt => {
                  const on = focusAreas.includes(opt);
                  return (
                    <TouchableOpacity
                      key={opt}
                      style={[s.tag, on && s.tagOn]}
                      onPress={() => toggleFocus(opt)}
                      activeOpacity={0.75}
                    >
                      {on && <Feather name="check" size={11} color="#FFF" />}
                      <Text style={[s.tagTxt, on && s.tagTxtOn]}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={s.messageWrap}>
                <View style={s.messageHeader}>
                  <Text style={s.sectionLabel}>YOUR MESSAGE</Text>
                  <Text style={[s.counter, !charsOk && { color: '#DC2626' }]}>
                    {message.trim().length < MIN_CHARS
                      ? `${MIN_CHARS - message.trim().length} more`
                      : `${remaining} left`}
                  </Text>
                </View>
                <TextInput
                  value={message}
                  onChangeText={t => t.length <= MAX_CHARS && setMessage(t)}
                  placeholder="Tell them who you are, what you're working on, and what you hope to get from the mentorship..."
                  placeholderTextColor="#9CA3AF"
                  style={s.input}
                  multiline
                  textAlignVertical="top"
                  autoFocus
                />
              </View>

              <View style={s.tipBox}>
                <Feather name="info" size={14} color="#1D4ED8" />
                <Text style={s.tipTxt}>
                  Strong requests mention your major or role, specific goals, and why this mentor stood out.
                </Text>
              </View>
            </ScrollView>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 200,
  },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 20,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#E0E0E0',
    alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0',
  },
  cancel: { fontSize: 15, color: '#8E8E93' },
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: '#000', textAlign: 'center', marginHorizontal: 12 },
  send: { fontSize: 15, fontWeight: '700', color: '#007AFF' },

  body: { padding: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#8E8E93', letterSpacing: 0.7, marginBottom: 10 },

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

  messageWrap: { marginTop: 22 },
  messageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  counter: { fontSize: 11, color: '#6B7280', marginBottom: 10 },
  input: {
    minHeight: 140, maxHeight: 220,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    fontSize: 14, color: '#111',
    lineHeight: 20,
  },

  tipBox: {
    flexDirection: 'row', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: 10,
    padding: 10, marginTop: 16,
  },
  tipTxt: { flex: 1, fontSize: 12, color: '#1E40AF', lineHeight: 17 },
});