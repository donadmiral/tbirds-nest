/**
 * HighlightRow — Memory atmosphere
 *
 * Rectangular memory cards instead of Instagram-style circles.
 * Each highlight has visual territory. Cover images fill the card.
 * Subtle gradient overlay for title legibility.
 *
 * Design: cinematic warmth, editorial spacing, memory-oriented.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import type { StoryHighlight } from '../../services/storiesService';

const NAVY = '#0B1E3D';
const CARD_W = 110;
const CARD_H = 148;
const CARD_R = 16;

type HighlightRowProps = {
  highlights: StoryHighlight[];
  isOwnProfile: boolean;
  onTap: (highlight: StoryHighlight) => void;
  onCreateNew: () => void;
  onLongPress?: (highlight: StoryHighlight) => void;
};

export default function HighlightRow({
  highlights,
  isOwnProfile,
  onTap,
  onCreateNew,
  onLongPress,
}: HighlightRowProps) {
  if (!isOwnProfile && highlights.length === 0) return null;

  return (
    <View style={s.container}>
      <Text style={s.sectionLabel}>Highlights</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.scroll}
      >
        {isOwnProfile && (
          <TouchableOpacity style={s.addCard} onPress={onCreateNew} activeOpacity={0.7}>
            <View style={s.addIconWrap}>
              <Feather name="plus" size={22} color={NAVY} />
            </View>
            <Text style={s.addLabel}>New</Text>
          </TouchableOpacity>
        )}
        {highlights.map(h => {
          const coverUri = h.cover_url || h.latest_story_media_url;
          return (
            <TouchableOpacity
              key={h.id}
              style={s.card}
              onPress={() => onTap(h)}
              onLongPress={() => onLongPress?.(h)}
              activeOpacity={0.85}
              delayLongPress={400}
            >
              {coverUri ? (
                <ExpoImage
                  source={{ uri: coverUri }}
                  style={s.coverImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={150}
                />
              ) : (
                <LinearGradient
                  colors={['#1A3560', '#0B1E3D']}
                  style={s.coverImage}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={s.fallbackLetter}>
                    {h.title.charAt(0).toUpperCase()}
                  </Text>
                </LinearGradient>
              )}
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.55)']}
                style={s.gradient}
              />
              <View style={s.cardBottom}>
                <Text style={s.cardTitle} numberOfLines={1}>{h.title}</Text>
                {h.story_count > 0 && (
                  <Text style={s.cardCount}>{h.story_count}</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  scroll: {
    paddingHorizontal: 16,
    gap: 10,
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: CARD_R,
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
  },
  coverImage: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: CARD_R,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: CARD_H * 0.45,
    borderBottomLeftRadius: CARD_R,
    borderBottomRightRadius: CARD_R,
  },
  cardBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 4,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
  cardCount: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 1,
  },
  fallbackLetter: {
    fontSize: 36,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
  },
  addCard: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: CARD_R,
    borderWidth: 1.5,
    borderColor: 'rgba(11,30,61,0.12)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(11,30,61,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: NAVY,
  },
});