import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../theme/useTheme';

/** Story metadata can arrive after the post. Keep its avatar surface and frame. */
export default function FeedAuthorAvatar({ userId, uri, name, storyUnseen, onStory }: {
  userId: string;
  uri?: string | null;
  name?: string | null;
  storyUnseen?: boolean;
  onStory: () => void;
}) {
  const { t } = useTheme();
  const source = useMemo(() => uri ? { uri } : null, [uri]);
  const hasStory = storyUnseen !== undefined;
  const letters = (name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toUpperCase();
  return (
    <View style={styles.slot}>
      <TouchableOpacity
        accessibilityRole={hasStory ? 'button' : undefined}
        accessibilityLabel={hasStory ? `View ${name || 'member'}'s story` : undefined}
        activeOpacity={0.8}
        disabled={!hasStory}
        onPress={onStory}
        style={styles.avatar}
      >
        {source ? <Image source={source} recyclingKey={`${userId}:${uri}`} style={styles.avatar}
          contentFit="cover" cachePolicy="memory-disk" transition={0} />
          : <View style={[styles.avatar, styles.fallback, { backgroundColor: t.status.linkBg }]}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: t.status.link }}>{letters}</Text>
          </View>}
        <View pointerEvents="none" style={[styles.ring, {
          borderColor: !hasStory ? 'transparent' : storyUnseen ? '#B08D3F' : t.ink.faint,
        }]} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { width: 50, height: 40, flexShrink: 0 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', top: -4, bottom: -4, left: -4, right: -4, borderRadius: 24, borderWidth: 2 },
});
