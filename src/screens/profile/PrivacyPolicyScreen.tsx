import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

const LAST_UPDATED = 'January 1, 2025';
const APP_NAME = 'PlatinumCircles';
const EMAIL = 'privacy@PlatinumCirclesnest.app';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text>{children}</View>;
}
function Para({ children }: { children: React.ReactNode }) { return <Text style={s.para}>{children}</Text>; }
function Bullet({ children }: { children: React.ReactNode }) {
  return <View style={s.bulletRow}><Text style={s.bullet}>•</Text><Text style={s.bulletTxt}>{children}</Text></View>;
}

export default function PrivacyPolicyScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}>
        <Text style={s.lastUpdated}>Last updated: {LAST_UPDATED}</Text>
        <Para>This Privacy Policy describes how {APP_NAME} collects, uses, and protects your information when you use our platform. We are committed to protecting your privacy and handling your data with transparency and care.</Para>

        <Section title="1. Information We Collect">
          <Para>We collect information you provide directly:</Para>
          <Bullet>Account information: name, email address, username, and password</Bullet>
          <Bullet>Profile information: bio, degree program, graduation year, location, role, and profile photo</Bullet>
          <Bullet>Content you post: posts, comments, messages, business listings, and event details</Bullet>
          <Bullet>Communications: messages you send to other users through the platform</Bullet>
          <Bullet>Support requests: information you provide when contacting our support team</Bullet>
          <Para>We also collect information automatically:</Para>
          <Bullet>Device information: device type, operating system, and app version</Bullet>
          <Bullet>Usage data: features you use, content you interact with, and time spent on the platform</Bullet>
          <Bullet>Log data: IP addresses, app crashes, and performance data</Bullet>
          <Bullet>Push notification tokens when you enable notifications</Bullet>
        </Section>

        <Section title="2. How We Use Your Information">
          <Para>We use the information we collect to:</Para>
          <Bullet>Provide, maintain, and improve the {APP_NAME} platform</Bullet>
          <Bullet>Create and manage your account</Bullet>
          <Bullet>Facilitate connections between Thunderbird community members</Bullet>
          <Bullet>Send push notifications about activity relevant to you</Bullet>
          <Bullet>Match you with relevant job opportunities and mentors</Bullet>
          <Bullet>Respond to your support requests and communications</Bullet>
          <Bullet>Detect and prevent fraudulent or harmful activity</Bullet>
          <Bullet>Analyze usage patterns to improve features and user experience</Bullet>
          <Bullet>Comply with legal obligations</Bullet>
        </Section>

        <Section title="3. Information Sharing">
          <Para>We do not sell, rent, or trade your personal information to third parties. We may share your information in the following limited circumstances:</Para>
          <Bullet>With other {APP_NAME} users, as part of the platform's social features (subject to your privacy settings)</Bullet>
          <Bullet>With service providers who assist us in operating the platform (e.g., cloud storage, analytics), bound by confidentiality agreements</Bullet>
          <Bullet>When required by law, court order, or government authority</Bullet>
          <Bullet>To protect the rights, property, or safety of {APP_NAME}, its users, or the public</Bullet>
          <Bullet>In connection with a merger, acquisition, or sale of assets, with notice provided to users</Bullet>
        </Section>

        <Section title="4. Privacy Controls">
          <Para>You control how your information is shared through your privacy settings:</Para>
          <Bullet>Public profile: Your profile is visible to all signed-in PlatinumCircles members</Bullet>
          <Bullet>Private profile: Only your accepted connections can see your full profile</Bullet>
          <Para>You can change your visibility settings at any time in Settings → Privacy. Note that content you post to the feed is visible to all authenticated members regardless of your profile privacy setting.</Para>
        </Section>

        <Section title="5. Data Security">
          <Para>We implement industry-standard security measures to protect your information, including encrypted data transmission (TLS/SSL), secure password hashing, and access controls limiting who can access user data. Our database is hosted on Supabase's secure infrastructure with row-level security policies.</Para>
          <Para>While we take security seriously, no method of transmission over the internet is 100% secure. We encourage you to use a strong, unique password and to report any suspected security issues to {EMAIL}.</Para>
        </Section>

        <Section title="6. Data Retention">
          <Para>We retain your personal information for as long as your account is active or as needed to provide services. If you delete your account, we will delete your personal data within 30 days, except where retention is required by law or necessary for legitimate business purposes (such as preventing fraud).</Para>
          <Para>Content you have posted may remain visible to users who have already seen it, though it will no longer be associated with your account after deletion.</Para>
        </Section>

        <Section title="7. Your Rights">
          <Para>Depending on your location, you may have the following rights regarding your personal data:</Para>
          <Bullet>Access: Request a copy of the personal data we hold about you</Bullet>
          <Bullet>Correction: Request that we correct inaccurate data</Bullet>
          <Bullet>Deletion: Request deletion of your personal data (the "right to be forgotten")</Bullet>
          <Bullet>Portability: Receive your data in a structured, commonly used format</Bullet>
          <Bullet>Objection: Object to certain types of data processing</Bullet>
          <Para>To exercise any of these rights, please contact us at {EMAIL}. We will respond within 30 days.</Para>
        </Section>

        <Section title="8. Push Notifications">
          <Para>We send push notifications to keep you informed about activity on the platform, including new messages, connection requests, and job alerts. You can manage notification preferences in Settings → Notifications. You can also disable all notifications through your device's system settings.</Para>
        </Section>

        <Section title="9. Children's Privacy">
          <Para>{APP_NAME} is not intended for users under 18 years of age. We do not knowingly collect personal information from minors. If we become aware that we have inadvertently collected information from a user under 18, we will take steps to delete it promptly.</Para>
        </Section>

        <Section title="10. Third-Party Services">
          <Para>Our platform uses third-party services including Supabase for database and authentication services. These services have their own privacy policies and we encourage you to review them. We are not responsible for the privacy practices of third-party services.</Para>
        </Section>

        <Section title="11. International Users">
          <Para>If you are accessing {APP_NAME} from outside the United States, please be aware that your information may be transferred to, stored, and processed in the United States. By using our platform, you consent to this transfer.</Para>
        </Section>

        <Section title="12. Changes to This Policy">
          <Para>We may update this Privacy Policy from time to time. We will notify you of significant changes through the app or by email. Your continued use of {APP_NAME} after changes take effect constitutes your acceptance of the revised Policy.</Para>
        </Section>

        <Section title="13. Contact Us">
          <Para>If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact our Privacy team:</Para>
          <Para>Email: {EMAIL}{'\n'}PlatinumCircles Privacy Team{'\n'}Thunderbird School of Global Management{'\n'}Arizona State University{'\n'}Glendale, Arizona, United States</Para>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginRight: 1 },
  backLbl: { fontSize: 17, color: '#007AFF' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000', flex: 1, textAlign: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  lastUpdated: { fontSize: 13, color: '#8E8E93', marginBottom: 16 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#000', marginBottom: 10 },
  para: { fontSize: 15, color: '#3C3C43', lineHeight: 24, marginBottom: 10 },
  bulletRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  bullet: { fontSize: 15, color: '#8E8E93', marginTop: 4 },
  bulletTxt: { flex: 1, fontSize: 15, color: '#3C3C43', lineHeight: 22 },
});