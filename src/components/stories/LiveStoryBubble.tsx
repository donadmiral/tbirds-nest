import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { themedSheet } from '../../theme/useTheme';
import type { LiveSession } from '../../../shared/liveDirectory';

/** A separate story action keeps the LIVE ring's destination unambiguous. */
export default function LiveStoryBubble({ session, onStory, onCreate, testPrefix = 'story' }: {
  session: LiveSession; onStory?: () => void; onCreate?: () => void; testPrefix?: string;
}) {
  const navigation = useNavigation<any>();
  if (session.state !== 'live' || session.ended_at) return null;
  const name = session.host.full_name || session.host.username || 'Member';
  return <View style={s.bubble}>
    <TouchableOpacity testID={`${testPrefix}-live-${session.host.id}`} accessibilityRole="button" accessibilityLabel={`Watch ${name} live`}
      activeOpacity={0.75} style={s.main} onPress={() => navigation.navigate('LiveSession', { sessionId: session.id })}>
      <View style={s.ring}>
        {session.host.avatar_url ? <Image source={{ uri: session.host.avatar_url }} style={s.avatar} /> : <View style={[s.avatar, s.fallback]}><Text style={s.initial}>{name.charAt(0).toUpperCase()}</Text></View>}
        <View style={s.badge}><Text style={s.badgeText}>LIVE</Text></View>
      </View>
      <Text numberOfLines={1} style={s.name}>{onCreate ? 'You' : name.split(' ')[0]}</Text>
    </TouchableOpacity>
    {onStory ? <TouchableOpacity testID={`${testPrefix}-story-${session.host.id}`} accessibilityRole="button" accessibilityLabel={`View ${onCreate ? 'your' : name + "'s"} story`} onPress={onStory} style={s.story}><Text style={s.storyText}>Story</Text></TouchableOpacity> : null}
    {onCreate ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Create a story" onPress={onCreate} style={s.create}><Text style={s.createText}>+</Text></TouchableOpacity> : null}
  </View>;
}
const s = themedSheet(t => ({
  bubble: { width: 68, alignItems: 'center', position: 'relative' },
  main: { alignItems: 'center', width: 68 },
  ring: { width: 66, height: 66, borderRadius: 33, borderWidth: 2.5, borderColor: '#D92547', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: t.surface.sunken },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 20, fontWeight: '700', color: t.ink.primary },
  badge: { position: 'absolute', bottom: -5, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#C8193B', borderColor: t.surface.canvas, borderWidth: 2 },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  name: { fontSize: 11, color: t.ink.primary, maxWidth: 68 },
  story: { minHeight: 44, minWidth: 52, alignItems: 'center', justifyContent: 'center' },
  storyText: { fontSize: 11, fontWeight: '600', color: t.ink.primary, textDecorationLine: 'underline' },
  create: { position: 'absolute', right: -10, top: 20, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  createText: { width: 22, height: 22, borderRadius: 11, overflow: 'hidden', textAlign: 'center', backgroundColor: t.brand.base, color: t.ink.inverse, fontSize: 19, lineHeight: 21 },
}));
