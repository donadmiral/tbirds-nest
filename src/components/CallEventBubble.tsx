/**
 * CallEventBubble.tsx
 * Renders call event system messages in chat.
 * Shows: Missed voice call, Video call · 05:23, Declined voice call, etc.
 * Centered row, no message bubble. Phone/video icon + status text.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

const TEXT_SECONDARY = '#8E8E93';

type Props = {
  content: string;
  mediaUrl: string | null;
  createdAt: string | null;
};

export default function CallEventBubble({ content, mediaUrl }: Props) {
  let callType: 'voice' | 'video' = 'voice';
  let status: string = 'ended';

  // Parse metadata from media_url JSON if available
  if (mediaUrl) {
    try {
      const meta = JSON.parse(mediaUrl);
      callType = meta.call_type === 'video' ? 'video' : 'voice';
      status = meta.status || 'ended';
    } catch {}
  } else {
    // Fallback: parse from content string
    if (content.toLowerCase().includes('video')) callType = 'video';
    if (content.toLowerCase().includes('missed')) status = 'missed';
    else if (content.toLowerCase().includes('declined')) status = 'declined';
  }

  const isMissed = status === 'missed';
  const isDeclined = status === 'declined';
  const iconName = callType === 'video' ? 'video' : 'phone';
  const iconColor = isMissed || isDeclined ? '#EF4444' : TEXT_SECONDARY;

  return (
    <View style={st.container}>
      <View style={st.pill}>
        <View style={[st.iconCircle, (isMissed || isDeclined) && st.iconCircleRed]}>
          <Feather name={iconName} size={12} color={iconColor} />
          {(isMissed || isDeclined) && (
            <View style={st.missedSlash}>
              <Feather name="x" size={8} color="#EF4444" />
            </View>
          )}
        </View>
        <Text style={[st.text, (isMissed || isDeclined) && st.textRed]}>
          {content}
        </Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F2F2F7',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  iconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E5E5EA',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconCircleRed: {
    backgroundColor: '#FEE2E2',
  },
  missedSlash: {
    position: 'absolute',
    bottom: -2,
    right: -2,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
  },
  textRed: {
    color: '#EF4444',
  },
});