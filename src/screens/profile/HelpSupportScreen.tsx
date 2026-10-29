import SettingsExit from '../../components/SettingsExit';
import { settingsBack } from '../../navigation/settingsNavigation';
/**
 * HelpSupportScreen - how the real app works, briefly and clearly.
 */
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';


const TOPICS: { icon: any; q: string; a: string }[] = [
  { icon: 'edit-3', q: 'Posting and who sees it', a: 'Tap the pen to compose. The audience chip beside your name controls who can see the post: everyone, followers, people you mention, or verified accounts. The lightning bolt sends a post to the Innovation channel, where you can add a field and a stage to what you are building.' },
  { icon: 'zap', q: 'Stories', a: 'Stories live for 24 hours in the strip at the top of For You and Latest. You control who can view, reply, and react from the story audience settings. A platinum ring around an avatar means there is a story to watch.' },
  { icon: 'trending-up', q: 'How Trending works', a: 'Trending is earned, never bought and never random. A post appears there only when several different real people engage it, and a story only when enough people outside the owner view and react. If the page is empty, nothing genuinely qualifies right now.' },
  { icon: 'message-circle', q: 'Messages and calls', a: 'Chats support text, photos, documents, and voice notes, and you can make voice and video calls, including group calls. Message requests from people you do not follow wait in Settings until you accept them. Market and job conversations keep their own inboxes so deals never mix with personal chats.' },
  { icon: 'shopping-bag', q: 'Buying and selling on Market', a: 'Listings are direct between you and the other person - message the seller from the listing, agree terms, and mark the item sold when it is done. Platinum Circles does not hold money or ship goods, so meet safely and confirm before you pay.' },
  { icon: 'briefcase', q: 'Jobs and applying', a: 'Every job shows its full description, what it offers, the deadline, and the employer. Apply with a cover note, your phone number, your CV, and a portfolio link. Track everything under My Applications, and posters manage applicants from the job itself.' },
  { icon: 'shield', q: 'Privacy and safety controls', a: 'From Settings you can make your profile private, control story and post audiences, review message requests, and block accounts. Blocking hides you from each other everywhere. You can report any post from its menu.' },
  { icon: 'alert-circle', q: 'Something looks wrong', a: 'Most display issues clear with a pull-to-refresh or by closing and reopening the app. If a problem stays, report the post or tell us through your profile - include what you tapped and what you expected, and we will chase it.' },
];

export default function HelpSupportScreen() {
  const navigation = useNavigation<any>();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => settingsBack(navigation, 'Settings')} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Help &amp; Support</Text>
        <SettingsExit navigation={navigation} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 110, 130) }}>
        <Text style={s.lede}>Short answers to how Platinum Circles works. Tap a topic.</Text>
        {TOPICS.map((t, i) => (
          <TouchableOpacity key={t.q} style={s.row} activeOpacity={0.85} onPress={() => setOpen(open === i ? null : i)}>
            <View style={s.rowHead}>
              <View style={s.iconWrap}><Feather name={t.icon} size={16} color={getTheme().ink.primary} /></View>
              <Text style={s.q}>{t.q}</Text>
              <Feather name={open === i ? 'chevron-up' : 'chevron-down'} size={17} color={getTheme().ink.muted} />
            </View>
            {open === i ? <Text style={s.a}>{t.a}</Text> : null}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 60 },
  backChev: { fontSize: 26, color: t.ink.primary, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: t.ink.primary, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: t.ink.primary },
  lede: { fontSize: 13, color: t.ink.muted, marginBottom: 14, marginTop: 4 },
  row: { backgroundColor: t.surface.sunken, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  q: { flex: 1, fontSize: 14, fontWeight: '700', color: t.ink.primary },
  a: { fontSize: 13, lineHeight: 20, color: t.ink.secondary, marginTop: 10, marginLeft: 40 },
}));