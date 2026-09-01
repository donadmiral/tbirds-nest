/**
 * QuizStickerCard - Instagram construction.
 * Light card, black type, full-width rows.
 * On answer: correct row fills green, a wrong pick fills red, counts reveal.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from 'react-native-reanimated';

type QuizOption = { id: string; label: string; isCorrect: boolean };

type Props = {
  question: string;
  options: QuizOption[];
  interactive: boolean;
  isOwn: boolean;
  myOptionId?: string | null;
  responseCounts?: Record<string, number>;
  totalResponses?: number;
  onSelectOption?: (optionId: string) => void;
  onTapViewResponses?: () => void;
};

const EASE = { duration: 520, easing: Easing.bezier(0.16, 1, 0.3, 1) };
const STAGGER = 70;

function Row({ option, index, revealed, chosen, pct, onPress }: {
  option: QuizOption; index: number; revealed: boolean; chosen: boolean; pct: number; onPress: () => void;
}) {
  const fill = useSharedValue(0);
  useEffect(() => {
    if (revealed) fill.value = withDelay(index * STAGGER, withTiming(pct, EASE));
    else fill.value = withTiming(0, { duration: 160 });
  }, [revealed, pct, index]);

  const barStyle = useAnimatedStyle(() => ({ width: ((fill.value * 100) + '%') as any }));
  const correct = revealed && option.isCorrect;
  const wrong = revealed && chosen && !option.isCorrect;

  return (
    <TouchableOpacity style={s.row} activeOpacity={0.85} onPress={onPress}>
      <Animated.View
        style={[s.bar, correct ? s.barCorrect : wrong ? s.barWrong : s.barPlain, barStyle]}
        pointerEvents="none"
      />
      <View style={s.rowInner}>
        <View style={[s.badge, correct && s.badgeCorrect, wrong && s.badgeWrong]}><Text style={s.badgeTxt}>{String.fromCharCode(65 + index)}</Text></View>
        <Text style={[s.label, (correct || wrong) && s.labelStrong]} numberOfLines={1}>{option.label}</Text>
        {correct ? <Text style={s.check}>{'\u2713'}</Text> : null}
      </View>
      {revealed && <Text style={[s.pct, (correct || wrong) && s.labelStrong]}>{Math.round(pct * 100)}%</Text>}
    </TouchableOpacity>
  );
}

export default function QuizStickerCard({
  question, options, interactive, isOwn, myOptionId,
  responseCounts, totalResponses = 0, onSelectOption, onTapViewResponses,
}: Props) {
  const [picked, setPicked] = useState<string | null>(myOptionId ?? null);
  const [optimistic, setOptimistic] = useState<Record<string, number>>({});

  useEffect(() => { setPicked(myOptionId ?? null); setOptimistic({}); }, [myOptionId]);

  const revealed = isOwn || !!picked;

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    options.forEach(o => { m[o.id] = (responseCounts?.[o.id] || 0) + (optimistic[o.id] || 0); });
    return m;
  }, [options, responseCounts, optimistic]);

  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0) || totalResponses, [counts, totalResponses]);

  const handle = useCallback((id: string) => {
    if (isOwn) { onTapViewResponses?.(); return; }
    if (!interactive || picked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPicked(id);
    setOptimistic(p => ({ ...p, [id]: (p[id] || 0) + 1 }));
    onSelectOption?.(id);
  }, [isOwn, interactive, picked, onSelectOption, onTapViewResponses]);

  return (
    <View style={s.card}>
      <Text style={s.question} numberOfLines={3}>{question}</Text>
      <View style={s.rows}>
        {options.map((o, i) => (
          <Row
            key={o.id}
            option={o}
            index={i}
            revealed={revealed}
            chosen={picked === o.id}
            pct={total > 0 ? (counts[o.id] || 0) / total : 0}
            onPress={() => handle(o.id)}
          />
        ))}
      </View>
      {revealed && <Text style={s.total}>{total} {total === 1 ? 'answer' : 'answers'}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { width: 268, backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  question: { fontSize: 16, fontWeight: '800', color: '#0B1E3D', letterSpacing: -0.2, textAlign: 'center', marginBottom: 12 },
  rows: { gap: 8 },
  row: { height: 46, borderRadius: 12, backgroundColor: '#F6F5F2', borderWidth: 1.5, borderColor: 'rgba(11,30,61,0.14)', justifyContent: 'center', paddingHorizontal: 12, overflow: 'hidden' },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 44 },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center' },
  badgeCorrect: { backgroundColor: '#2F9E63' },
  badgeWrong: { backgroundColor: '#C62F1D' },
  badgeTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  check: { color: '#0B1E3D', fontSize: 15, fontWeight: '800' },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  barPlain: { backgroundColor: 'rgba(11,30,61,0.10)' },
  barCorrect: { backgroundColor: '#DCF5E6' },
  barWrong: { backgroundColor: '#FBE1E1' },
  label: { fontSize: 14.5, fontWeight: '600', color: '#0B1E3D', letterSpacing: -0.2, flexShrink: 1 },
  labelStrong: { fontWeight: '800' },
  pct: { position: 'absolute', right: 12, fontSize: 14, fontWeight: '800', color: '#0B1E3D', fontVariant: ['tabular-nums'] },
  total: { marginTop: 10, fontSize: 12, fontWeight: '600', color: 'rgba(11,30,61,0.55)', textAlign: 'center' },
});