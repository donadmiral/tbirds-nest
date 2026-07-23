/**
 * PollCard - Instagram-construction poll for the story viewer.
 * Solid light card, black type, full-width option rows.
 * After voting, rows fill as bars with the percentage on the right.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

type PollOption = { id: string; label: string; vote_count: number };

type PollData = {
  poll_id: string;
  question: string;
  options: PollOption[];
  total_votes: number;
  my_vote: string | null;
  ny?: number;
  nx?: number;
};

type PollCardProps = {
  poll: PollData;
  isOwn: boolean;
  onVote: (optionId: string) => void;
  onOpenVoters: (optionId: string) => void;
};

const BAR_EASE = { duration: 520, easing: Easing.bezier(0.16, 1, 0.3, 1) };
const STAGGER = 70;

function OptionRow({
  label,
  pct,
  chosen,
  revealed,
  index,
  onPress,
}: {
  label: string;
  pct: number;
  chosen: boolean;
  revealed: boolean;
  index: number;
  onPress: () => void;
}) {
  const fill = useSharedValue(0);

  useEffect(() => {
    if (revealed) {
      fill.value = withDelay(index * STAGGER, withTiming(pct, BAR_EASE));
    } else {
      fill.value = withTiming(0, { duration: 180 });
    }
  }, [revealed, pct, index]);

  const barStyle = useAnimatedStyle(() => ({
    width: (fill.value * 100).toString() + '%',
  }));

  return (
    <TouchableOpacity
      style={s.row}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityLabel={label}
    >
      <Animated.View
        style={[s.bar, chosen ? s.barChosen : s.barPlain, barStyle]}
        pointerEvents="none"
      />
      <Text style={[s.rowLabel, chosen && s.rowLabelChosen]} numberOfLines={1}>
        {label}
      </Text>
      {revealed && (
        <Text style={[s.rowPct, chosen && s.rowLabelChosen]}>
          {Math.round(pct * 100)}%
        </Text>
      )}
    </TouchableOpacity>
  );
}

export default function PollCard({ poll, isOwn, onVote, onOpenVoters }: PollCardProps) {
  const [myVote, setMyVote] = useState<string | null>(poll.my_vote);
  const [optimistic, setOptimistic] = useState<Record<string, number>>({});

  useEffect(() => {
    setMyVote(poll.my_vote);
    setOptimistic({});
  }, [poll.poll_id, poll.my_vote]);

  const revealed = isOwn || !!myVote;

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    poll.options.forEach(o => {
      map[o.id] = (o.vote_count || 0) + (optimistic[o.id] || 0);
    });
    return map;
  }, [poll.options, optimistic]);

  const total = useMemo(
    () => Object.values(counts).reduce((a, b) => a + b, 0),
    [counts]
  );

  const handlePress = useCallback(
    (optionId: string) => {
      if (isOwn) {
        onOpenVoters(optionId);
        return;
      }
      if (myVote) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setMyVote(optionId);
      setOptimistic(prev => ({ ...prev, [optionId]: (prev[optionId] || 0) + 1 }));
      onVote(optionId);
    },
    [isOwn, myVote, onVote, onOpenVoters]
  );

  return (
    <View style={s.card}>
      <Text style={s.question} numberOfLines={3}>
        {poll.question}
      </Text>

      <View style={s.rows}>
        {poll.options.map((o, i) => (
          <OptionRow
            key={o.id}
            label={o.label}
            pct={total > 0 ? (counts[o.id] || 0) / total : 0}
            chosen={myVote === o.id}
            revealed={revealed}
            index={i}
            onPress={() => handlePress(o.id)}
          />
        ))}
      </View>

      {revealed && (
        <Text style={s.total}>
          {total} {total === 1 ? 'vote' : 'votes'}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  question: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0A0A0A',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 12,
  },
  rows: { gap: 8 },
  row: {
    height: 44,
    borderRadius: 11,
    backgroundColor: 'rgba(10,10,10,0.05)',
    justifyContent: 'center',
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  barPlain: { backgroundColor: 'rgba(10,10,10,0.10)' },
  barChosen: { backgroundColor: 'rgba(10,10,10,0.20)' },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#0A0A0A',
    letterSpacing: -0.2,
    paddingRight: 44,
  },
  rowLabelChosen: { fontWeight: '800' },
  rowPct: {
    position: 'absolute',
    right: 14,
    fontSize: 15,
    fontWeight: '600',
    color: '#0A0A0A',
  },
  total: {
    marginTop: 10,
    fontSize: 12.5,
    fontWeight: '600',
    color: 'rgba(10,10,10,0.5)',
    textAlign: 'center',
  },
});