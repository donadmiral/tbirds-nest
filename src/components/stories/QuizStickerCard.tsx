/**
 * QuizStickerCard — Interactive quiz sticker for story viewer
 *
 * Emotional design:
 * - 300ms suspense delay between tap and reveal
 * - Green pulse + haptic success for correct answer
 * - Red pulse + haptic rigid for wrong answer + correct reveal after 200ms
 * - Animated percentage bars with stagger
 * - Token-governed styling
 *
 * Physics: Reanimated shared values for all animations (UI thread)
 */

import React, { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
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
  runOnJS,
} from 'react-native-reanimated';
import {
  palette, surface, text as textColor, accent, border as borderColor,
  space, radius, borderRadius,
  typeSize, fontWeight as fw,
} from '../../constants/tokens';

// ── Types ──

type QuizOption = {
  id: string;
  label: string;
  isCorrect: boolean;
};

type QuizStickerCardProps = {
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

// ── Constants ──

const CARD_WIDTH = 260;
const SUSPENSE_DELAY = 300;
const BAR_ANIMATE_DURATION = 500;
const BAR_STAGGER = 80;
const PULSE_DURATION = 400;
const CORRECT_REVEAL_DELAY = 200;

const SOFT_SETTLE = { duration: BAR_ANIMATE_DURATION, easing: Easing.bezier(0.16, 1, 0.3, 1) };

// ── Individual option component with its own animation state ──

function QuizOptionRow({
  option,
  index,
  totalOptions,
  showResults,
  hasAnswered,
  isMyPick,
  isCorrect,
  showCorrectReveal,
  showWrongReveal,
  pct,
  interactive,
  isOwn,
  onPress,
}: {
  option: QuizOption;
  index: number;
  totalOptions: number;
  showResults: boolean;
  hasAnswered: boolean;
  isMyPick: boolean;
  isCorrect: boolean;
  showCorrectReveal: boolean;
  showWrongReveal: boolean;
  pct: number;
  interactive: boolean;
  isOwn: boolean;
  onPress: () => void;
}) {
  const barWidth = useSharedValue(0);
  const pctOpacity = useSharedValue(0);
  const bgPulse = useSharedValue(0);
  const iconScale = useSharedValue(0);

  useEffect(() => {
    if (showResults) {
      // Stagger the bar animation
      const delay = index * BAR_STAGGER;
      barWidth.value = withDelay(delay, withTiming(pct, SOFT_SETTLE));
      pctOpacity.value = withDelay(delay + BAR_ANIMATE_DURATION * 0.5, withTiming(1, { duration: 200 }));

      // Correct/wrong pulse
      if (showCorrectReveal) {
        bgPulse.value = withDelay(delay, withSequence(
          withTiming(1, { duration: PULSE_DURATION / 2 }),
          withTiming(0.3, { duration: PULSE_DURATION / 2 })
        ));
        iconScale.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 200 }));
      } else if (showWrongReveal) {
        bgPulse.value = withDelay(delay, withSequence(
          withTiming(1, { duration: PULSE_DURATION / 3 }),
          withTiming(0, { duration: PULSE_DURATION / 3 })
        ));
        iconScale.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 200 }));
      }
    } else {
      barWidth.value = 0;
      pctOpacity.value = 0;
      bgPulse.value = 0;
      iconScale.value = 0;
    }
  }, [showResults, pct, showCorrectReveal, showWrongReveal, index]);

  const barAnimStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value}%`,
  }));

  const pctAnimStyle = useAnimatedStyle(() => ({
    opacity: pctOpacity.value,
  }));

  const iconAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconScale.value,
  }));

  const bgAnimStyle = useAnimatedStyle(() => {
    if (showCorrectReveal) {
      return { backgroundColor: `rgba(52,199,89,${0.08 + bgPulse.value * 0.08})` };
    }
    if (showWrongReveal) {
      return { backgroundColor: `rgba(255,59,48,${bgPulse.value * 0.12})` };
    }
    return {};
  });

  return (
    <TouchableOpacity
      style={[
        s.option,
        showCorrectReveal && s.optionCorrect,
        showWrongReveal && s.optionWrong,
      ]}
      activeOpacity={0.7}
      onPress={onPress}
      disabled={!interactive || isOwn || hasAnswered}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 14 }, bgAnimStyle]} />

      {showResults && (
        <Animated.View
          style={[
            s.optionBar,
            barAnimStyle,
            showCorrectReveal && s.optionBarCorrect,
            showWrongReveal && s.optionBarWrong,
          ]}
        />
      )}

      <View style={s.optionContent}>
        <View style={s.optionLeft}>
          {showResults && (showCorrectReveal || showWrongReveal) && (
            <Animated.View style={iconAnimStyle}>
              {showCorrectReveal && <Feather name="check-circle" size={15} color={accent.success} />}
              {showWrongReveal && <Feather name="x-circle" size={15} color={accent.error} />}
            </Animated.View>
          )}
          {!showResults && (
            <View style={s.optionCircle} />
          )}
          <Text
            style={[
              s.optionLabel,
              showCorrectReveal && s.optionLabelCorrect,
              showWrongReveal && s.optionLabelWrong,
            ]}
            numberOfLines={2}
          >
            {option.label}
          </Text>
        </View>
        {showResults && (
          <Animated.Text style={[s.optionPct, pctAnimStyle]}>
            {pct}%
          </Animated.Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Main component ──

export default function QuizStickerCard({
  question,
  options,
  interactive,
  isOwn,
  myOptionId,
  responseCounts = {},
  totalResponses = 0,
  onSelectOption,
  onTapViewResponses,
}: QuizStickerCardProps) {
  const hasAnswered = myOptionId != null;
  const showResults = hasAnswered || isOwn;

  // Suspense state: after tap, delay reveal
  const [pendingOptionId, setPendingOptionId] = React.useState<string | null>(null);
  const [revealReady, setRevealReady] = React.useState(false);

  // When myOptionId changes from external source (network confirm), allow reveal
  useEffect(() => {
    if (hasAnswered && !revealReady) {
      setRevealReady(true);
    }
  }, [hasAnswered]);

  const handleSelect = useCallback((optionId: string) => {
    if (!interactive || isOwn || hasAnswered || pendingOptionId) return;

    // Immediate haptic
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingOptionId(optionId);

    // Fire the actual selection (network call)
    onSelectOption?.(optionId);

    // Suspense delay before visual reveal
    setTimeout(() => {
      setRevealReady(true);
      // Delayed haptic for result
      const selectedOption = options.find(o => o.id === optionId);
      if (selectedOption?.isCorrect) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }, SUSPENSE_DELAY);
  }, [interactive, isOwn, hasAnswered, pendingOptionId, onSelectOption, options]);

  // Determine effective display state
  const effectiveMyOptionId = myOptionId || pendingOptionId;
  const effectiveHasAnswered = effectiveMyOptionId != null;
  const effectiveShowResults = (effectiveHasAnswered && revealReady) || isOwn;

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.iconWrap}>
          <Feather name="help-circle" size={12} color="#A78BFA" />
        </View>
        <Text style={s.headerLabel}>QUIZ</Text>
        {effectiveShowResults && totalResponses > 0 && (
          <TouchableOpacity onPress={onTapViewResponses} activeOpacity={0.7}>
            <Text style={s.countLabel}>
              {totalResponses} {totalResponses === 1 ? 'answer' : 'answers'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={s.question}>{question}</Text>

      {options.map((opt, index) => {
        const count = responseCounts[opt.id] || 0;
        const pct = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0;
        const isMyPick = effectiveMyOptionId === opt.id;
        const isCorrect = opt.isCorrect;
        const showCorrectReveal = effectiveShowResults && isCorrect;
        const showWrongReveal = effectiveShowResults && isMyPick && !isCorrect;

        // During suspense: show pending indicator on tapped option
        const isPending = pendingOptionId === opt.id && !revealReady;

        return (
          <View key={opt.id}>
            <QuizOptionRow
              option={opt}
              index={index}
              totalOptions={options.length}
              showResults={effectiveShowResults}
              hasAnswered={effectiveHasAnswered}
              isMyPick={isMyPick}
              isCorrect={isCorrect}
              showCorrectReveal={showCorrectReveal}
              showWrongReveal={showWrongReveal}
              pct={pct}
              interactive={interactive}
              isOwn={isOwn}
              onPress={() => handleSelect(opt.id)}
            />
            {isPending && (
              <View style={s.pendingDot}>
                <View style={s.pendingDotInner} />
              </View>
            )}
          </View>
        );
      })}

      {interactive && !isOwn && effectiveHasAnswered && revealReady && (
        <View style={s.answeredRow}>
          <Feather name="check" size={10} color={accent.success} />
          <Text style={s.answeredText}>
            {effectiveMyOptionId && options.find(o => o.id === effectiveMyOptionId)?.isCorrect
              ? 'Correct!'
              : 'Answered'}
          </Text>
        </View>
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
    paddingVertical: space.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: borderColor.soft,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginBottom: space.xs,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(167,139,250,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    fontSize: typeSize.micro,
    fontWeight: fw.bold,
    color: textColor.faint,
    letterSpacing: 0.8,
    flex: 1,
  },
  countLabel: {
    fontSize: typeSize.micro,
    fontWeight: fw.semibold,
    color: textColor.faint,
  },
  question: {
    fontSize: typeSize.emphasis,
    fontWeight: fw.bold,
    color: textColor.primary,
    lineHeight: 20,
    marginBottom: space.sm,
  },
  option: {
    backgroundColor: surface.elevated,
    borderRadius: 14,
    marginBottom: space.xs,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: borderColor.soft,
    minHeight: 46,
  },
  optionCorrect: {
    borderColor: 'rgba(52,199,89,0.35)',
  },
  optionWrong: {
    borderColor: 'rgba(255,59,48,0.35)',
  },
  optionBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
  },
  optionBarCorrect: {
    backgroundColor: 'rgba(52,199,89,0.12)',
  },
  optionBarWrong: {
    backgroundColor: 'rgba(255,59,48,0.08)',
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
  optionCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: borderColor.default,
  },
  optionLabel: {
    fontSize: typeSize.caption,
    fontWeight: fw.semibold,
    color: textColor.primary,
    flexShrink: 1,
  },
  optionLabelCorrect: {
    color: accent.success,
    fontWeight: fw.bold,
  },
  optionLabelWrong: {
    color: accent.error,
  },
  optionPct: {
    fontSize: typeSize.caption,
    fontWeight: fw.bold,
    color: textColor.secondary,
    marginLeft: space.xs,
  },
  pendingDot: {
    position: 'absolute',
    right: space.sm,
    top: '50%',
    marginTop: -4,
  },
  pendingDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: textColor.faint,
  },
  answeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    alignSelf: 'center',
    marginTop: space.xs,
  },
  answeredText: {
    fontSize: typeSize.micro,
    fontWeight: fw.semibold,
    color: 'rgba(52,199,89,0.8)',
  },
});