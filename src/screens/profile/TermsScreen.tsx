import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

const LAST_UPDATED = 'January 1, 2025';
const APP_NAME = 'PlatinumCircles';
const COMPANY = 'PlatinumCircles';
const EMAIL = 'legal@PlatinumCirclesnest.app';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Para({ children }: { children: React.ReactNode }) {
  return <Text style={s.para}>{children}</Text>;
}
function Bullet({ children }: { children: React.ReactNode }) {
  return <View style={s.bulletRow}><Text style={s.bullet}>•</Text><Text style={s.bulletTxt}>{children}</Text></View>;
}

export default function TermsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text>
          <Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Terms of Service</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}>
        <Text style={s.lastUpdated}>Last updated: {LAST_UPDATED}</Text>
        <Para>Welcome to {APP_NAME}. By accessing or using our application, you agree to be bound by these Terms of Service. Please read them carefully. If you do not agree to these terms, you may not use {APP_NAME}.</Para>

        <Section title="1. Acceptance of Terms">
          <Para>By creating an account or using {APP_NAME}, you confirm that you are at least 18 years of age, you have read and understood these Terms, and you agree to be legally bound by them. These Terms constitute a legally binding agreement between you and {COMPANY}.</Para>
        </Section>

        <Section title="2. Description of Service">
          <Para>{APP_NAME} is a private social networking platform built exclusively for students, alumni, faculty, and staff of the Thunderbird School of Global Management at Arizona State University. The platform provides tools for professional networking, community building, mentorship, career development, and social connection within the Thunderbird community.</Para>
          <Para>Features include but are not limited to: social feed and posts, direct messaging, job board and referrals, mentorship matching, Mingle events, Startup Hub, the Market, and Network connections.</Para>
        </Section>

        <Section title="3. Eligibility">
          <Para>Access to {APP_NAME} is limited to verified members of the Thunderbird School of Global Management community. You must:</Para>
          <Bullet>Be a current student, alumnus/alumna, faculty member, or staff member of Thunderbird School of Global Management</Bullet>
          <Bullet>Provide accurate and truthful registration information</Bullet>
          <Bullet>Maintain the accuracy of your profile information</Bullet>
          <Bullet>Be at least 18 years of age</Bullet>
        </Section>

        <Section title="4. User Accounts">
          <Para>You are responsible for maintaining the confidentiality of your account credentials. You agree to notify us immediately at {EMAIL} if you suspect any unauthorized use of your account. You may not share your account with others or create accounts for third parties.</Para>
          <Para>We reserve the right to suspend or terminate accounts that violate these Terms, provide false information, or engage in behavior harmful to the community.</Para>
        </Section>

        <Section title="5. User Content">
          <Para>You retain ownership of any content you post on {APP_NAME}, including text, images, and other media. By posting content, you grant {COMPANY} a non-exclusive, worldwide, royalty-free license to display, distribute, and promote your content within the platform.</Para>
          <Para>You agree that your content will not:</Para>
          <Bullet>Be false, misleading, or fraudulent</Bullet>
          <Bullet>Violate any intellectual property rights of others</Bullet>
          <Bullet>Contain harassment, hate speech, or discriminatory language</Bullet>
          <Bullet>Include spam, unsolicited commercial messages, or pyramid schemes</Bullet>
          <Bullet>Violate any applicable law or regulation</Bullet>
          <Bullet>Contain malware, viruses, or harmful code</Bullet>
          <Bullet>Impersonate any person or entity</Bullet>
          <Para>We reserve the right to remove any content that violates these Terms at our sole discretion.</Para>
        </Section>

        <Section title="6. Acceptable Use">
          <Para>You agree to use {APP_NAME} only for lawful purposes and in a manner consistent with the professional standards of the Thunderbird community. You will not:</Para>
          <Bullet>Attempt to gain unauthorized access to any part of the platform</Bullet>
          <Bullet>Use automated scripts or bots to collect data</Bullet>
          <Bullet>Interfere with the normal operation of the platform</Bullet>
          <Bullet>Sell, trade, or transfer your account to another person</Bullet>
          <Bullet>Use the platform for commercial solicitation without prior written approval</Bullet>
          <Bullet>Collect personal information about other users without their consent</Bullet>
        </Section>

        <Section title="7. Privacy">
          <Para>Your use of {APP_NAME} is also governed by our Privacy Policy, which is incorporated into these Terms by reference. By using the platform, you consent to our collection and use of information as described in the Privacy Policy.</Para>
        </Section>

        <Section title="8. Intellectual Property">
          <Para>All content, features, and functionality of {APP_NAME}, including but not limited to the design, graphics, logos, icons, and software, are the exclusive property of {COMPANY} and are protected by applicable intellectual property laws.</Para>
          <Para>You may not reproduce, distribute, modify, or create derivative works of any platform content without our express written permission.</Para>
        </Section>

        <Section title="9. Mentorship and Professional Interactions">
          <Para>The mentorship features of {APP_NAME} are provided as tools to facilitate connections within the Thunderbird community. {COMPANY} does not guarantee the quality, accuracy, or outcomes of any mentorship relationship formed through the platform. Users engage in mentorship arrangements at their own discretion and risk.</Para>
        </Section>

        <Section title="10. Job Board and Career Features">
          <Para>Job listings, referrals, and career-related content on {APP_NAME} are provided for informational purposes. {COMPANY} does not guarantee employment outcomes, the accuracy of job listings, or the conduct of employers or users who engage through the platform's career features.</Para>
        </Section>

        <Section title="11. Disclaimer of Warranties">
          <Para>{APP_NAME} is provided on an "as is" and "as available" basis without any warranties of any kind, either express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the platform will be uninterrupted, error-free, or free of harmful components.</Para>
        </Section>

        <Section title="12. Limitation of Liability">
          <Para>To the fullest extent permitted by applicable law, {COMPANY} shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, or goodwill, arising from your use or inability to use the platform, even if we have been advised of the possibility of such damages.</Para>
        </Section>

        <Section title="13. Indemnification">
          <Para>You agree to defend, indemnify, and hold harmless {COMPANY} and its affiliates from and against any claims, damages, obligations, losses, liabilities, and expenses arising from: (a) your use of the platform; (b) your violation of these Terms; (c) your violation of any third-party rights; or (d) any content you post on the platform.</Para>
        </Section>

        <Section title="14. Termination">
          <Para>We may terminate or suspend your account and access to {APP_NAME} immediately, without prior notice, for any reason, including breach of these Terms. You may terminate your account at any time by contacting us at {EMAIL}.</Para>
          <Para>Upon termination, your right to use the platform ceases immediately. Provisions of these Terms that by their nature should survive termination shall survive, including ownership provisions, warranty disclaimers, and limitations of liability.</Para>
        </Section>

        <Section title="15. Governing Law">
          <Para>These Terms shall be governed by and construed in accordance with the laws of the State of Arizona, United States, without regard to its conflict of law provisions. Any disputes arising from these Terms shall be resolved in the courts of Maricopa County, Arizona.</Para>
        </Section>

        <Section title="16. Changes to Terms">
          <Para>We reserve the right to modify these Terms at any time. We will notify users of material changes through the application or by email. Your continued use of {APP_NAME} after changes take effect constitutes your acceptance of the revised Terms.</Para>
        </Section>

        <Section title="17. Contact Information">
          <Para>If you have questions about these Terms of Service, please contact us at:</Para>
          <Para>PlatinumCircles{'\n'}Email: {EMAIL}{'\n'}Thunderbird School of Global Management{'\n'}Arizona State University{'\n'}Glendale, Arizona, United States</Para>
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