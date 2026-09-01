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
  card: { width: 268, backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 14, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  prompt: { fontSize: 16, fontWeight: '800', color: '#0B1E3D', letterSpacing: -0.2, textAlign: 'center', marginBottom: 12 },
  field: { height: 44, borderRadius: 12, backgroundColor: '#F6F5F2', borderWidth: 1.5, borderColor: 'rgba(11,30,61,0.14)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  fieldAnswered: { backgroundColor: 'rgba(201,191,176,0.35)', borderColor: '#C9BFB0' },
  fieldTxt: { fontSize: 15, fontWeight: '600', color: 'rgba(11,30,61,0.5)', letterSpacing: -0.2 },
  fieldTxtAnswered: { color: '#0B1E3D', fontWeight: '800' },
});