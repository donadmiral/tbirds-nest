/**
 * PrivacyPolicyScreen - what is collected, how it is used, and your controls.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

const NAVY = '#0B1E3D';

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.sec}>
      <Text style={s.secTitle}>{title}</Text>
      <Text style={s.body}>{children}</Text>
    </View>
  );
}

export default function PrivacyPolicyScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 110, 130) }}>
        <Text style={s.updated}>Effective 28 July 2026</Text>

        <Sec title="1. What we collect">Your account and profile details - name, username, photo, headline, and anything you add. The content you create: posts, stories, comments, messages, media, listings, job posts, and applications including a CV, phone number, or portfolio you choose to attach. Usage signals such as which posts appear on your screen, and technical basics like device type and a push notification token.</Sec>

        <Sec title="2. How it is used">To run the service: delivering your messages and calls, showing your posts to the audiences you chose, and sending the notifications you enable. To rank honestly: signals like unique real engagement decide feeds and Trending - never paid placement disguised as ranking. Your Reached number counts distinct people who saw your posts and is shown only to you. And to keep people safe: enforcing the rules and acting on reports and blocks.</Sec>

        <Sec title="3. What we never do">We do not sell your personal information. We do not read your private messages for advertising. We do not show your private performance data to anyone but you.</Sec>

        <Sec title="4. Sharing">Content is shared exactly as widely as your audience settings say. Behind the scenes, trusted infrastructure providers process data on our behalf - hosting, storage, media handling, and push delivery - bound to use it only for running the service. Information may be disclosed if the law genuinely requires it.</Sec>

        <Sec title="5. Your controls">Edit your profile anytime. Set your profile private, choose per-post and per-story audiences, review message requests, and block accounts - blocking hides you from each other across the app. Deleting your account from Settings removes your profile and content from the service.</Sec>

        <Sec title="6. Security and retention">Data travels encrypted and lives in access-controlled cloud storage. We keep information while your account is active and for the short period needed to run backups and honour legal duties after deletion.</Sec>

        <Sec title="7. Children">Platinum Circles is not for children under 13, and we remove accounts that are.</Sec>

        <Sec title="8. Changes">This policy may be updated as the service grows. Meaningful changes will be announced in the app.</Sec>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 60 },
  backChev: { fontSize: 26, color: NAVY, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: NAVY, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: NAVY },
  updated: { fontSize: 12, color: 'rgba(11,30,61,0.45)', marginBottom: 14, marginTop: 4 },
  sec: { marginBottom: 16 },
  secTitle: { fontSize: 14.5, fontWeight: '800', color: NAVY, marginBottom: 6 },
  body: { fontSize: 13.5, lineHeight: 21, color: 'rgba(11,30,61,0.8)' },
});