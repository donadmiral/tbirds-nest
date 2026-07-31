import React from 'react';
import { View, Text, StyleSheet, Linking, Dimensions } from 'react-native';
import { stickerTextStyle } from '../../utils/stickerStyles';
import StickerPill from './StickerPill';
import PostStoryCard from './PostStoryCard';
import QuestionStickerCard from './QuestionStickerCard';
import SliderStickerCard from './SliderStickerCard';
import QuizStickerCard from './QuizStickerCard';
import type { StoryTextSticker } from '../../services/storiesService';

// Phase 2.3: Match composer's text wrapping width (85% of screen)
const SCREEN_W = Dimensions.get('window').width;
const TEXT_STICKER_MAX_W = Math.round(SCREEN_W * 0.85);

type StickerOverlayProps = {
  stickers: StoryTextSticker[];
  containerW: number;
  containerH: number;
  onMentionTap?: (userId: string) => void;
  onHashtagTap?: (tag: string) => void;
  onPostTap?: (postId: string) => void;
  onStickerLayout?: (id: string, rect: { left: number; right: number; top: number; bottom: number }) => void;
  interactive?: boolean;
  // Engagement sticker interaction callbacks (viewer only)
  engagementProps?: {
    isOwn: boolean;
    storyId: string;
    myResponses: Record<string, any>;
    responseCounts: Record<string, number>;
    responseAverages: Record<string, number>;
    quizResponseCounts: Record<string, Record<string, number>>;
    onTapQuestionAnswer?: (stickerId: string) => void;
    onSubmitSlider?: (stickerId: string, value: number) => void;
    onSelectQuizOption?: (stickerId: string, optionId: string) => void;
    onViewResponses?: (stickerId: string, responseType: 'question' | 'slider' | 'quiz') => void;
  };
};

function getWidthForKind(kind?: string): number {
  if (kind === 'post') return 300;
  if (kind === 'question') return 240;
  if (kind === 'slider') return 240;
  if (kind === 'quiz') return 260;
  // Phase 2.3: Text stickers need wider container for wrapping parity with composer
  // Emoji and pill stickers keep the original 160px
  if (kind === 'emoji') return 160;
  if (kind === 'link' || kind === 'location' || kind === 'mention' || kind === 'hashtag') return 160;
  // Text stickers: use the same max width as the composer
  return TEXT_STICKER_MAX_W;
}

export function renderStickerContent(
  sticker: StoryTextSticker,
  onMentionTap?: (userId: string) => void,
  interactive: boolean = true,
  engagementProps?: StickerOverlayProps['engagementProps'],
  onHashtagTap?: (tag: string) => void,
  onPostTap?: (postId: string) => void,
): React.ReactNode {
  const isEmoji = sticker.kind === 'emoji';
  const isLink = sticker.kind === 'link';
  const isLocation = sticker.kind === 'location';
  const isMention = sticker.kind === 'mention';
  const isPill = isLink || isLocation || isMention;
  const isQuestion = sticker.kind === 'question';
  const isSlider = sticker.kind === 'slider';
  const isQuiz = sticker.kind === 'quiz';

  if (sticker.kind === 'post') {
    return (
      <PostStoryCard
        sticker={sticker}
        onPress={interactive && onPostTap && sticker.postId ? () => onPostTap(sticker.postId!) : undefined}
      />
    );
  }

  if (isQuestion) {
    const ep = engagementProps;
    const myResp = ep?.myResponses[sticker.id];
    const count = ep?.responseCounts[sticker.id] ?? 0;
    return (
      <QuestionStickerCard
        prompt={sticker.questionPrompt || sticker.text}
        interactive={interactive && !!ep}
        isOwn={ep?.isOwn ?? false}
        myAnswer={myResp?.text_value}
        responseCount={count}
        onTapAnswer={() => ep?.onTapQuestionAnswer?.(sticker.id)}
        onTapViewResponses={() => ep?.onViewResponses?.(sticker.id, 'question')}
      />
    );
  }

  if (isSlider) {
    const ep = engagementProps;
    const myResp = ep?.myResponses[sticker.id];
    const avg = ep?.responseAverages[sticker.id] ?? null;
    const count = ep?.responseCounts[sticker.id] ?? 0;
    return (
      <SliderStickerCard
        label={sticker.sliderLabel || sticker.text}
        emoji={sticker.sliderEmoji || '❤️'}
        interactive={interactive && !!ep}
        isOwn={ep?.isOwn ?? false}
        myValue={myResp?.number_value ?? null}
        averageValue={avg}
        responseCount={count}
        onSubmit={(val) => ep?.onSubmitSlider?.(sticker.id, val)}
      />
    );
  }

  if (isQuiz) {
    const ep = engagementProps;
    const myResp = ep?.myResponses[sticker.id];
    const opts = sticker.quizOptions || [];
    const counts = ep?.quizResponseCounts[sticker.id] || {};
    const totalResp = ep?.responseCounts[sticker.id] ?? 0;
    return (
      <QuizStickerCard
        question={sticker.quizQuestion || sticker.text}
        options={opts}
        interactive={interactive && !!ep}
        isOwn={ep?.isOwn ?? false}
        myOptionId={myResp?.option_id}
        responseCounts={counts}
        totalResponses={totalResp}
        onSelectOption={(optId) => ep?.onSelectQuizOption?.(sticker.id, optId)}
        onTapViewResponses={() => ep?.onViewResponses?.(sticker.id, 'quiz')}
      />
    );
  }

  if (isPill) {
    let handlePress: (() => void) | undefined;
    if (interactive) {
      handlePress = () => {
        if (isLink && sticker.url) {
          Linking.openURL(sticker.url).catch(() => {});
        } else if (isLocation) {
          const hasCoords = sticker.locationLat !== undefined && sticker.locationLng !== undefined;
          const mapsUrl = hasCoords
            ? `https://www.google.com/maps/search/?api=1&query=${sticker.locationLat},${sticker.locationLng}`
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sticker.locationName || sticker.text)}`;
          Linking.openURL(mapsUrl).catch(() => {});
        } else if (isMention && sticker.mentionUserId && onMentionTap) {
          onMentionTap(sticker.mentionUserId);
        } else if (sticker.kind === 'hashtag' && onHashtagTap) {
          onHashtagTap(sticker.hashtag || sticker.text.replace(/^#/, ''));
        }
      };
    }
    return (
      <StickerPill
        label={sticker.text}
        kind={sticker.kind as 'link' | 'location' | 'mention' | 'hashtag'}
        onPress={handlePress}
      />
    );
  }

  if (isEmoji) {
    return <Text style={{ fontSize: 44 }}>{sticker.text}</Text>;
  }

  // Phase 2.3: Text sticker with maxWidth for natural wrapping (no truncation)
  const { textStyle, wrapperStyle } = stickerTextStyle(
    sticker.style,
    sticker.color,
    sticker.bgEnabled,
    sticker.fontSizeOverride,
  );
  const opacityStyle = (sticker.opacity !== undefined && sticker.opacity < 1)
    ? { opacity: sticker.opacity } : undefined;

  return (
    <View style={[wrapperStyle, opacityStyle]}>
      <Text style={[textStyle, { maxWidth: TEXT_STICKER_MAX_W }]}>{sticker.text}</Text>
    </View>
  );
}

export default function StickerOverlay({
  stickers,
  containerW,
  containerH,
  onMentionTap,
  onHashtagTap,
  onPostTap,
  onStickerLayout,
  interactive = true,
  engagementProps,
}: StickerOverlayProps) {
  if (!stickers || stickers.length === 0 || containerW === 0 || containerH === 0) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 20, elevation: 20 }]} pointerEvents="box-none">
      {stickers.map(st => {
        const isEmoji = st.kind === 'emoji';
        const isPill = st.kind === 'link' || st.kind === 'location' || st.kind === 'mention' || st.kind === 'hashtag' || st.kind === 'post';
        const isEngagement = st.kind === 'question' || st.kind === 'slider' || st.kind === 'quiz';
        const containerAlign = isEmoji || isPill ? 'center' as const
          : st.textAlign === 'left' ? 'flex-start' as const
          : st.textAlign === 'right' ? 'flex-end' as const
          : 'center' as const;

        const stickerWidth = getWidthForKind(st.kind);
        const halfW = stickerWidth / 2;

        return (
          <View
            key={st.id}
            pointerEvents={interactive ? ((isPill || isEngagement) ? 'auto' : 'none') : 'none'}
            onTouchStart={() => console.log('[sticker-touch]', st.kind, 'reached wrapper')}
            onLayout={interactive && (isPill || isEngagement) && onStickerLayout ? (e: any) => { const t: any = e.currentTarget || e.target; t?.measureInWindow?.((x: number, y: number, w: number, h: number) => { if (w && h) onStickerLayout(st.id, { left: x, right: x + w, top: y, bottom: y + h }); }); } : undefined}
            style={{
              position: 'absolute',
              left: st.nx * containerW,
              top: st.ny * containerH,
              transform: [
                { translateX: -halfW },
                { translateY: -25 },
                { scale: st.scale },
                { rotate: `${st.rotation}rad` },
              ],
              alignItems: isEngagement ? 'center' as const : containerAlign,
              justifyContent: 'center',
              width: stickerWidth,
              zIndex: interactive && (isPill || isEngagement) ? 30 : 20,
              elevation: interactive && (isPill || isEngagement) ? 30 : 20,
            }}
          >
            {renderStickerContent(st, onMentionTap, interactive, engagementProps, onHashtagTap, onPostTap)}
          </View>
        );
      })}
    </View>
  );
}