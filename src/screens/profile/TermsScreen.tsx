/**
 * TermsScreen - the terms of service for the real Platinum Circles.
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

export default function TermsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Terms of Service</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 110, 130) }}>
        <Text style={s.updated}>Effective 28 July 2026</Text>

        <Sec title="1. Agreement">Platinum Circles is a social and professional network for Zimbabwe. By creating an account or using the app, you agree to these terms. If you do not agree, do not use the service.</Sec>

        <Sec title="2. Your account">You must be at least 13 years old. Keep your account information accurate and your credentials private - what happens under your account is your responsibility. One person, one identity: impersonation is not allowed.</Sec>

        <Sec title="3. What the service includes">Feed posts and stories, direct and group messaging with voice and video calls, the Market for peer-to-peer listings, the Jobs board and applications, the Innovation channel, and business accounts. Features may change as the service grows.</Sec>

        <Sec title="4. Your content">What you post stays yours. By posting, you give Platinum Circles the permission needed to store, display, and distribute that content within the service - showing your post in feeds, previews, and notifications. Delete your content and that permission ends, except for copies already shared by others, such as reposts.</Sec>

        <Sec title="5. Conduct">Do not use Platinum Circles to harass, threaten, defraud, impersonate, or spam; to post content that is illegal, hateful, or sexually exploits anyone; to scrape the service or interfere with its operation; or to misrepresent listings, jobs, or your identity. We can remove content and restrict or terminate accounts that break these rules.</Sec>

        <Sec title="6. The Market">Listings are transactions between you and the other person. Platinum Circles does not hold money, take commissions, process payments, ship goods, or guarantee any item or buyer. Inspect before you pay, meet safely, and mark items sold when done. Deals are made at your own judgement.</Sec>

        <Sec title="7. Jobs">Job posts are provided by their posters. Platinum Circles does not verify every listing and does not guarantee employment, interviews, or the accuracy of any posting. Never pay anyone to apply for a job.</Sec>

        <Sec title="8. Messages and calls">Messages, media, and call signalling are stored and transmitted to deliver the service across your devices. Do not record or share private conversations without consent, and do not use messaging to break section 5.</Sec>

        <Sec title="9. Termination">You can delete your account at any time from Settings, which removes your profile and content from the service. We may suspend or terminate accounts that violate these terms or put other people at risk.</Sec>

        <Sec title="10. Disclaimers">The service is provided as-is, without warranties of uninterrupted operation or error-free behaviour. To the fullest extent the law allows, Platinum Circles is not liable for losses arising from user content, Market deals, job applications, or service interruptions.</Sec>

        <Sec title="11. Changes">These terms may be updated as the service evolves. Meaningful changes will be announced in the app, and continued use after a change means acceptance.</Sec>
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