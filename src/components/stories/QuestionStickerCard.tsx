/**
 * QuestionStickerCard - Instagram construction.
 * Light card, prompt in black, a soft input-looking row beneath it.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

type Props = {
  prompt: string;
  interactive: boolean;
  isOwn: boolean;
  myAnswer?: string | null;
  responseCount?: number;
  onTapAnswer?: () => void;
  onTapViewResponses?: () => void;
};

export default function QuestionStickerCard({
  prompt, interactive, isOwn, myAnswer, responseCount = 0, onTapAnswer, onTapViewResponses,
}: Props) {
  const answered = !!myAnswer;

  return (
    <View style={s.card}>
      <Text style={s.prompt} numberOfLines={3}>{prompt}</Text>

      {isOwn ? (
        <TouchableOpacity style={s.field} activeOpacity={0.85} onPress={onTapViewResponses}>
          <Text style={s.fieldTxt} numberOfLines={1}>
            {responseCount > 0
              ? `${responseCount} ${responseCount === 1 ? 'response' : 'responses'}`
              : 'No responses yet'}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[s.field, answered && s.fieldAnswered]}
          activeOpacity={0.85}
          onPress={interactive && !answered ? onTapAnswer : undefined}
          disabled={!interactive || answered}
        >
          <Text style={[s.fieldTxt, answered && s.fieldTxtAnswered]} numberOfLines={1}>
            {answered ? myAnswer : 'Type something...'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { width: 268, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 18, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 14, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  prompt: { fontSize: 16, fontWeight: '700', color: '#0A0A0A', letterSpacing: -0.3, textAlign: 'center', marginBottom: 12 },
  field: { height: 44, borderRadius: 11, backgroundColor: 'rgba(10,10,10,0.06)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  fieldAnswered: { backgroundColor: 'rgba(10,10,10,0.14)' },
  fieldTxt: { fontSize: 15, fontWeight: '500', color: 'rgba(10,10,10,0.45)', letterSpacing: -0.2 },
  fieldTxtAnswered: { color: '#0A0A0A', fontWeight: '700' },
});