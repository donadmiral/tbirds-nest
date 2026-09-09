/**
 * Magic ball: ask it something, tap it, and it answers. The answer is drawn
 * on the viewer's phone; nothing is stored.
 */
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
const ANSWERS = ['Yes', 'No', 'Absolutely', 'Not today', 'Ask again later', 'Without a doubt', 'Very doubtful', 'Signs point to yes', 'Better not', 'Count on it', 'Cannot predict now', 'Most likely'];
export default function MagicBallStickerCard({ question, interactive, fixedAnswer, onAnswer, onHold, isOwn, shakeCount = 0, onViewShakes }: { question: string; interactive?: boolean; fixedAnswer?: string | null; onAnswer?: (answer: string) => void; onHold?: (holding: boolean) => void; isOwn?: boolean; shakeCount?: number; onViewShakes?: () => void }) {
  const [answer, setAnswer] = useState<string | null>(fixedAnswer || null);
  const shake = useRef(new Animated.Value(0)).current;
  const ask = () => {
    if (!interactive || fixedAnswer) return;
    if (isOwn) { onViewShakes?.(); return; }
    onHold?.(true); setTimeout(() => onHold?.(false), 6000);
    setAnswer(null);
    Animated.sequence([0, 1, -1, 1, -1, 0].map((v) => Animated.timing(shake, { toValue: v * 6, duration: 55, useNativeDriver: true }))).start(() => { const a = ANSWERS[Math.floor(Math.random() * ANSWERS.length)]; setAnswer(a); onAnswer?.(a); });
  };
  return (
    <View style={cs.card}>
      <Text style={cs.q} numberOfLines={3}>{question || 'Ask the ball'}</Text>
      <TouchableOpacity onPress={ask} activeOpacity={0.85} disabled={!interactive}>
        <Animated.View style={[cs.ball, { transform: [{ translateX: shake }] }]}>
          <View style={cs.window}>{answer ? <Text style={cs.answer} numberOfLines={3}>{answer}</Text> : <Text style={cs.eight}>8</Text>}</View>
        </Animated.View>
      </TouchableOpacity>
      <Text style={cs.hint}>{fixedAnswer ? 'The ball has spoken' : isOwn && interactive ? shakeCount + (shakeCount === 1 ? ' shake · See' : ' shakes · See') : answer ? 'Tap to ask again' : interactive ? 'Tap the ball' : 'Viewers tap to ask'}</Text>
    </View>
  );
}
const cs = StyleSheet.create({
  card: { width: 200, alignItems: 'center', paddingVertical: 6 },
  q: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 10, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  ball: { width: 132, height: 132, borderRadius: 66, backgroundColor: '#0B0B0F', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  window: { width: 74, height: 74, borderRadius: 37, backgroundColor: '#1B2A6B', alignItems: 'center', justifyContent: 'center', padding: 6 },
  eight: { color: '#FFFFFF', fontSize: 34, fontWeight: '900' },
  answer: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800', textAlign: 'center' },
  hint: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700', marginTop: 8, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
});