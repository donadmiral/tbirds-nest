/**
 * PollCard — Socially expressive poll interaction for story viewer
 *
 * Emotional arc: curiosity → deliberation → commitment → anticipation → resolution
 *
 * Choreography:
 * - Frame 0: Haptic + optimistic blue highlight + checkmark fade
 * - Frame 200ms: Reveal begins
 * - Frame 200-750ms: Bars grow with 80ms stagger, percentages fade in at 40% bar width
 * - Frame 750-950ms: Total votes drift up + fade in, card settle spring
 * - Frame 950ms+: Resolved. No lingering motion.
 *
 * All animation on UI thread via Reanimated shared values.
 * Zero re-renders during reveal sequence.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import {
  palette, surface, text as textColor, accent, border as borderColor,
  space, radius, borderRadius,
  typeSize, fontWeight as fw,
} from '../../constants/tokens';

// ── Types ──

type PollOption = {
  id: string;
  label: string;
  vote_count: number;
};

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

// ── Constants ──

const CARD_WIDTH = '100%';
const REVEAL_DELAY = 200;
const BAR_DURATION = 550;
const BAR_STAGGER = 80;
const SETTLE_DELAY = 150;

const SOFT_SETTLE = { duration: BAR_DURATION, easing: Easing.bezier(0.16, 1, 0.3, 1) };
const VOTE_BLUE = 'rgba(59,130,246,0.12)';
const VOTE_BLUE_BORDER = 'rgba(59,130,246,0.25)';
const VOTE_BAR = 'rgba(59,130,246,0.15)';
const DEFAULT_BAR = 'rgba(255,255,255,0.06)';

// ── Option row with its own animation state ──

function PollOptionRow({
  option,
  index,
  isMyVote,
  isWinner,
  pct,
  showResults,
  interactive,
  isOwn,
  hasVoted,
  isPending,
  onPress,
}: {
  option: PollOption;
  index: number;
  isMyVote: boolean;
  isWinner: boolean;
  pct: number;
  showResults: boolean;
  interactive: boolean;
  isOwn: boolean;
  hasVoted: boolean;
  isPending: boolean;
  onPress: () => void;
}) {
  const barWidth = useSharedValue(0);
  const pctOpacity = useSharedValue(0);
  const checkOpacity = useSharedValue(isPending || isMyVote ? 1 : 0);
  const highlightOpacity = useSharedValue(isPending || isMyVote ? 1 : 0);

  useEffect(() => {
    if (showResults) {
      const delay = REVEAL_DELAY + index * BAR_STAGGER;
      barWidth.value = withDelay(delay, withTiming(pct, SOFT_SETTLE));
      pctOpacity.value = withDelay(delay + BAR_DURATION * 0.4, withTiming(1, { duration: 200 }));
    }
  }, [showResults, pct, index]);

  // Optimistic highlight
  useEffect(() => {
    if (isPending || isMyVote) {
      highlightOpacity.value = withTiming(1, { duration: 120 });
      checkOpacity.value = withTiming(1, { duration: 120 });
    } else {
      highlightOpacity.value = withTiming(0, { duration: 200 });
      checkOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [isPending, isMyVote]);

  const barAnimStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value}%`,
  }));

  const pctAnimStyle = useAnimatedStyle(() => ({
    opacity: pctOpacity.value,
  }));

  const checkAnimStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
  }));

  const highlightAnimStyle = useAnimatedStyle(() => ({
    backgroundColor: isMyVote || isPending
      ? `rgba(59,130,246,${highlightOpacity.value * 0.1})`
      : 'transparent',
    borderColor: isMyVote || isPending
      ? `rgba(59,130,246,${highlightOpacity.value * 0.25})`
      : borderColor.soft,
  }));

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      disabled={hasVoted || isOwn || !interactive || isPending}
    >
      <Animated.View style={[s.option, highlightAnimStyle]}>
        {showResults && (
          <Animated.View
            style={[
              s.optionBar,
              barAnimStyle,
              isMyVote ? s.optionBarVoted : null,
            ]}
          />
        )}

        <View style={s.optionContent}>
          <View style={s.optionLeft}>
            {(isMyVote || isPending) && (
              <Animated.View style={checkAnimStyle}>
                <Feather name="check" size={13} color="rgba(59,130,246,0.8)" />
              </Animated.View>
            )}
            <Text
              style={[
                s.optionLabel,
                isMyVote && s.optionLabelVoted,
                showResults && isWinner && s.optionLabelWinner,
              ]}
              numberOfLines={2}
            >
              {option.label}
            </Text>
          </View>

          {showResults && (
            <Animated.Text
              style={[
                s.optionPct,
                isWinner && s.optionPctWinner,
                pctAnimStyle,
              ]}
            >
              {pct}%
            </Animated.Text>
          )}
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ── Main component ──

export default function PollCard({ poll, isOwn, onVote, onOpenVoters }: PollCardProps) {
  const [optimisticVoteId, setOptimisticVoteId] = useState<string | null>(null);
  const [revealReady, setRevealReady] = useState(poll.my_vote !== null || isOwn);

  const totalOpacity = useSharedValue(revealReady ? 1 : 0);
  const totalTranslateY = useSharedValue(revealReady ? 0 : 4);

  // When confirmed vote arrives, trigger reveal
  useEffect(() => {
    if (poll.my_vote !== null && !revealReady) {
      setRevealReady(true);
    }
  }, [poll.my_vote]);

  // Owner sees results immediately
  useEffect(() => {
    if (isOwn && !revealReady) {
      setRevealReady(true);
    }
  }, [isOwn]);

  // Animate total votes appearance after bars complete
  useEffect(() => {
    if (revealReady) {
      const totalDelay = REVEAL_DELAY + (poll.options.length - 1) * BAR_STAGGER + BAR_DURATION + SETTLE_DELAY;
      totalOpacity.value = withDelay(totalDelay, withTiming(1, { duration: 200 }));
      totalTranslateY.value = withDelay(totalDelay, withTiming(0, { duration: 250, easing: Easing.bezier(0.16, 1, 0.3, 1) }));
    }
  }, [revealReady, poll.options.length]);

  const totalAnimStyle = useAnimatedStyle(() => ({
    opacity: totalOpacity.value,
    transform: [{ translateY: totalTranslateY.value }],
  }));

  const handleVote = useCallback((optionId: string) => {
    if (optimisticVoteId || poll.my_vote !== null) return;

    // Immediate haptic
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Optimistic state
    setOptimisticVoteId(optionId);

    // Fire network call
    onVote(optionId);

    // Trigger reveal after commitment window
    setTimeout(() => {
      setRevealReady(true);
    }, REVEAL_DELAY);
  }, [optimisticVoteId, poll.my_vote, onVote]);

  // Determine effective state
  const effectiveVoteId = poll.my_vote || optimisticVoteId;
  const hasVoted = effectiveVoteId !== null;
  const showResults = revealReady && (hasVoted || isOwn);

  // Find winner
  const maxVotes = Math.max(...poll.options.map(o => o.vote_count), 0);
  const winnerId = maxVotes > 0 ? poll.options.find(o => o.vote_count === maxVotes)?.id : null;

  return (
    <View style={s.card}>
      <Text style={s.question}>{poll.question}</Text>

      {poll.options.map((opt, index) => {
        const pct = poll.total_votes > 0
          ? Math.round((opt.vote_count / poll.total_votes) * 100)
          : 0;
        const isMyVote = effectiveVoteId === opt.id;
        const isWinner = winnerId === opt.id && showResults;
        const isPending = optimisticVoteId === opt.id && !poll.my_vote;

        return (
          <PollOptionRow
            key={opt.id}
            option={opt}
            index={index}
            isMyVote={isMyVote}
            isWinner={isWinner}
            pct={pct}
            showResults={showResults}
            interactive={!isOwn && !hasVoted}
            isOwn={isOwn}
            hasVoted={hasVoted}
            isPending={isPending}
            onPress={() => {
              if (isOwn) {
                onOpenVoters(opt.id);
              } else {
                handleVote(opt.id);
              }
            }}
          />
        );
      })}

      {showResults && (
        <Animated.View style={[s.totalRow, totalAnimStyle]}>
          <Text style={s.totalText}>
            {poll.total_votes} {poll.total_votes === 1 ? 'vote' : 'votes'}
            {isOwn ? ' · Tap to see voters' : ''}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

// ── Styles ──

const s = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: 'rgba(20,20,20,0.85)',
    borderRadius: borderRadius.storyCanvas,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: borderColor.soft,
  },
  question: {
    fontSize: typeSize.subhead,
    fontWeight: fw.bold,
    color: textColor.primary,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: space.sm,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  option: {
    borderRadius: 14,
    marginBottom: space.xs,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: borderColor.soft,
    minHeight: 46,
    backgroundColor: surface.elevated,
  },
  optionBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: DEFAULT_BAR,
    borderRadius: 14,
  },
  optionBarVoted: {
    backgroundColor: VOTE_BAR,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.sm,
    zIndex: 1,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    flex: 1,
  },
  optionLabel: {
    fontSize: typeSize.caption,
    fontWeight: fw.medium,
    color: textColor.primary,
    flexShrink: 1,
  },
  optionLabelVoted: {
    fontWeight: fw.bold,
  },
  optionLabelWinner: {
    fontWeight: fw.bold,
  },
  optionPct: {
    fontSize: typeSize.caption,
    fontWeight: fw.bold,
    color: textColor.secondary,
    marginLeft: space.xs,
    minWidth: 30,
    textAlign: 'right',
  },
  optionPctWinner: {
    color: textColor.primary,
  },
  totalRow: {
    alignItems: 'center',
    marginTop: space.xs,
  },
  totalText: {
    fontSize: typeSize.micro,
    fontWeight: fw.medium,
    color: textColor.faint,
  },
});