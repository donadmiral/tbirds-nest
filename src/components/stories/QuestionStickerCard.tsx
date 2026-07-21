/**
 * QuestionStickerCard — Personal question prompt for story viewer
 *
 * Emotional design:
 * - The input row should feel like a warm invitation, not a form field
 * - Answered state communicates personal connection
 * - Owner view shows response count with gentle affordance
 * - Token-governed styling consistent with PollCard/QuizStickerCard
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  surface, text as textColor, accent, border as borderColor,
  space, borderRadius,
  typeSize, fontWeight as fw,
} from '../../constants/tokens';

// ── Types ──

type QuestionStickerCardProps = {
  prompt: string;
  interactive: boolean;
  isOwn: boolean;
  myAnswer?: string | null;
  responseCount?: number;
  onTapAnswer?: () => void;
  onTapViewResponses?: () => void;
};

// ── Component ──

export default function QuestionStickerCard({
  prompt,
  interactive,
  isOwn,
  myAnswer,
  responseCount = 0,
  onTapAnswer,
  onTapViewResponses,
}: QuestionStickerCardProps) {
  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.iconWrap}>
          <Feather name="message-circle" size={12} color="#60A5FA" />
        </View>
        <Text style={s.headerLabel}>QUESTION</Text>
      </View>

      <Text style={s.prompt}>{prompt}</Text>

      {interactive && isOwn && (
        <TouchableOpacity style={s.ownerRow} onPress={onTapViewResponses} activeOpacity={0.7}>
          <Feather name="users" size={13} color={textColor.muted} />
          <Text style={s.ownerTxt}>
            {responseCount === 0
              ? 'No answers yet'
              : `${responseCount} ${responseCount === 1 ? 'answer' : 'answers'}`}
          </Text>
          {responseCount > 0 && (
            <Feather name="chevron-right" size={13} color={textColor.faint} />
          )}
        </TouchableOpacity>
      )}

      {interactive && !isOwn && !myAnswer && (
        <TouchableOpacity style={s.inputRow} onPress={onTapAnswer} activeOpacity={0.75}>
          <Text style={s.inputPlaceholder}>Share your thoughts...</Text>
          <Feather name="send" size={13} color={textColor.faint} />
        </TouchableOpacity>
      )}

      {interactive && !isOwn && myAnswer && (
        <TouchableOpacity style={s.answeredRow} onPress={onTapAnswer} activeOpacity={0.75}>
          <View style={s.answeredBadge}>
            <Feather name="check" size={11} color={accent.success} />
          </View>
          <Text style={s.answeredTxt} numberOfLines={1}>{myAnswer}</Text>
          <Feather name="edit-2" size={11} color={textColor.faint} />
        </TouchableOpacity>
      )}

      {!interactive && (
        <View style={s.inputRow}>
          <Text style={s.inputPlaceholder}>Share your thoughts...</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ──

const s = StyleSheet.create({
  card: {
    width: 240,
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
    backgroundColor: 'rgba(96,165,250,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    fontSize: typeSize.micro,
    fontWeight: fw.bold,
    color: textColor.faint,
    letterSpacing: 0.8,
  },
  prompt: {
    fontSize: typeSize.emphasis,
    fontWeight: fw.bold,
    color: textColor.primary,
    lineHeight: 20,
    marginBottom: space.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: surface.secondary,
    borderRadius: 14,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: borderColor.soft,
  },
  inputPlaceholder: {
    fontSize: typeSize.caption,
    fontWeight: fw.medium,
    color: textColor.faint,
  },
  answeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: 'rgba(52,199,89,0.1)',
    borderRadius: 14,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(52,199,89,0.2)',
  },
  answeredBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(52,199,89,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  answeredTxt: {
    flex: 1,
    fontSize: typeSize.caption,
    fontWeight: fw.semibold,
    color: 'rgba(255,255,255,0.85)',
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: surface.secondary,
    borderRadius: 14,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: borderColor.soft,
  },
  ownerTxt: {
    flex: 1,
    fontSize: typeSize.caption,
    fontWeight: fw.semibold,
    color: textColor.muted,
  },
});