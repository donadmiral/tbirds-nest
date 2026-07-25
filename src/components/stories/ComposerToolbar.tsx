import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

type ComposerToolbarProps = {
  textCount: number;
  emojiCount: number;
  linkCount: number;
  locationCount: number;
  mentionCount: number;
  hasPoll: boolean;
  questionCount: number;
  sliderCount: number;
  quizCount: number;
  publishing: boolean;
  onOpenText: () => void;
  onOpenEmoji: () => void;
  onOpenLink: () => void;
  onOpenLocation: () => void;
  onOpenMention: () => void;
  onOpenPoll: () => void;
  onRemovePoll: () => void;
  onOpenQuestion: () => void;
  onOpenSlider: () => void;
  onOpenQuiz: () => void;
};

export default function ComposerToolbar({
  textCount,
  emojiCount,
  linkCount,
  locationCount,
  mentionCount,
  hasPoll,
  questionCount,
  sliderCount,
  quizCount,
  publishing,
  onOpenText,
  onOpenEmoji,
  onOpenLink,
  onOpenLocation,
  onOpenMention,
  onOpenPoll,
  onRemovePoll,
  onOpenQuestion,
  onOpenSlider,
  onOpenQuiz,
}: ComposerToolbarProps) {
  const hasText = textCount > 0;
  const hasEmoji = emojiCount > 0;
  const hasLink = linkCount > 0;
  const hasLocation = locationCount > 0;
  const hasMention = mentionCount > 0;
  const hasQuestion = questionCount > 0;
  const hasSlider = sliderCount > 0;
  const hasQuiz = quizCount > 0;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
    >
      <TouchableOpacity
        style={[s.btn, hasText && s.btnActive]}
        onPress={onOpenText}
        activeOpacity={0.75}
        disabled={publishing}
      >
        <Text style={[s.toolBtnText, hasText && { color: '#FFF' }]}>Aa</Text>
        <Text style={[s.btnTxt, hasText && s.btnTxtActive]}>
          {hasText ? `${textCount} Text` : 'Add Text'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.btn, hasEmoji && s.btnActive]}
        onPress={onOpenEmoji}
        activeOpacity={0.75}
        disabled={publishing}
      >
        <Text style={{ fontSize: 16 }}>😀</Text>
        <Text style={[s.btnTxt, hasEmoji && s.btnTxtActive]}>
          {hasEmoji ? `${emojiCount} Emoji` : 'Emoji'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.btn, hasLink && s.btnActive]}
        onPress={onOpenLink}
        activeOpacity={0.75}
        disabled={publishing}
      >
        <Feather name="link" size={16} color={hasLink ? '#FFF' : 'rgba(255,255,255,0.7)'} />
        <Text style={[s.btnTxt, hasLink && s.btnTxtActive]}>
          {hasLink ? `${linkCount} Link` : 'Link'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.btn, hasLocation && s.btnActive]}
        onPress={onOpenLocation}
        activeOpacity={0.75}
        disabled={publishing}
      >
        <Feather name="map-pin" size={16} color={hasLocation ? '#FFF' : 'rgba(255,255,255,0.7)'} />
        <Text style={[s.btnTxt, hasLocation && s.btnTxtActive]}>
          {hasLocation ? `${locationCount} Place` : 'Place'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.btn, hasMention && s.btnActive]}
        onPress={onOpenMention}
        activeOpacity={0.75}
        disabled={publishing}
      >
        <Feather name="at-sign" size={16} color={hasMention ? '#FFF' : 'rgba(255,255,255,0.7)'} />
        <Text style={[s.btnTxt, hasMention && s.btnTxtActive]}>
          {hasMention ? `${mentionCount} Mention` : 'Mention'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.btn, hasQuestion && s.btnActive]}
        onPress={onOpenQuestion}
        activeOpacity={0.75}
        disabled={publishing}
      >
        <Feather name="message-circle" size={16} color={hasQuestion ? '#FFF' : 'rgba(255,255,255,0.7)'} />
        <Text style={[s.btnTxt, hasQuestion && s.btnTxtActive]}>
          {hasQuestion ? `${questionCount} Q` : 'Question'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.btn, hasSlider && s.btnActive]}
        onPress={onOpenSlider}
        activeOpacity={0.75}
        disabled={publishing}
      >
        <Feather name="sliders" size={16} color={hasSlider ? '#FFF' : 'rgba(255,255,255,0.7)'} />
        <Text style={[s.btnTxt, hasSlider && s.btnTxtActive]}>
          {hasSlider ? `${sliderCount} Slider` : 'Slider'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.btn, hasQuiz && s.btnActive]}
        onPress={onOpenQuiz}
        activeOpacity={0.75}
        disabled={publishing}
      >
        <Feather name="help-circle" size={16} color={hasQuiz ? '#FFF' : 'rgba(255,255,255,0.7)'} />
        <Text style={[s.btnTxt, hasQuiz && s.btnTxtActive]}>
          {hasQuiz ? `${quizCount} Quiz` : 'Quiz'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.btn, hasPoll && s.btnActive]}
        onPress={onOpenPoll}
        activeOpacity={0.75}
        disabled={publishing}
      >
        <Feather name="bar-chart-2" size={16} color={hasPoll ? '#FFF' : 'rgba(255,255,255,0.7)'} />
        <Text style={[s.btnTxt, hasPoll && s.btnTxtActive]}>
          {hasPoll ? 'Edit Poll' : 'Add Poll'}
        </Text>
      </TouchableOpacity>

      {hasPoll && (
        <TouchableOpacity
          style={s.removeBtn}
          onPress={onRemovePoll}
          activeOpacity={0.75}
          disabled={publishing}
        >
          <Feather name="x" size={14} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4, paddingRight: 20,
    backgroundColor: '#000', gap: 6,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9,
  },
  btnActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  btnTxt: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },
  btnTxtActive: { color: '#0B1E3D', fontWeight: '700' },
  toolBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  removeBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
});