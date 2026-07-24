import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Linking } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

const VERSION = '1.0.0';
const BUILD   = '100';

export default function AboutScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>About PlatinumCircles</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}>

        {/* Logo / hero */}
        <View style={s.hero}>
          <View style={s.logoCircle}>
            <Text style={s.logoTxt}>T</Text>
          </View>
          <Text style={s.appName}>PlatinumCircles</Text>
          <Text style={s.tagline}>The home of the Thunderbird community</Text>
          <View style={s.versionRow}>
            <View style={s.versionPill}><Text style={s.versionTxt}>Version {VERSION} ({BUILD})</Text></View>
          </View>
        </View>

        {/* Mission */}
        <View style={s.missionCard}>
          <Text style={s.missionTitle}>Our Mission</Text>
          <Text style={s.missionTxt}>PlatinumCircles exists to connect the global Thunderbird community — students, alumni, faculty, and staff — in one professional space built specifically for us. We believe the power of Thunderbird lies in its people, and our mission is to make that network stronger, more accessible, and more meaningful every day.</Text>
        </View>

        {/* Features */}
        <Text style={s.featuresTitle}>What You Can Do</Text>
        {[
          { icon: 'rss',         label: 'Feed',          desc: 'Share updates, ideas, and experiences with your cohort and the wider community.' },
          { icon: 'users',       label: 'Network',        desc: 'Follow people you admire and build your professional network.' },
          { icon: 'briefcase',   label: 'Jobs',           desc: 'Discover career opportunities, request referrals, and track your applications — all within the PlatinumCircles community.' },
          { icon: 'message-circle', label: 'Messaging',   desc: 'Have real conversations with classmates, mentors, and colleagues in private or group chats.' },
          { icon: 'zap',         label: 'Mentorship',     desc: 'Find a mentor who has walked your path, or become one yourself for the next generation of PlatinumCircles.' },
          { icon: 'star',        label: 'Startup Hub',    desc: 'Share your startup idea, attract interest from fellow PlatinumCircles investors and collaborators.' },
          { icon: 'coffee',      label: 'Mingle',         desc: 'Organize and join events, hangouts, study sessions, and social gatherings — wherever PlatinumCircles are in the world.' },
          { icon: 'shopping-bag', label: "Bird's Business", desc: 'Showcase and discover businesses founded by Thunderbird community members.' },
          { icon: 'award',       label: 'Mentorship',     desc: 'Get guidance from alumni with real-world expertise in your industry.' },
        ].map(f => (
          <View key={f.label + f.desc} style={s.featureRow}>
            <View style={s.featureIcon}><Feather name={f.icon as any} size={20} color="#007AFF" /></View>
            <View style={s.featureInfo}>
              <Text style={s.featureLabel}>{f.label}</Text>
              <Text style={s.featureDesc}>{f.desc}</Text>
            </View>
          </View>
        ))}

        {/* Thunderbird */}
        <View style={s.thunderbirdCard}>
          <Text style={s.thunderbirdTitle}>About Thunderbird School</Text>
          <Text style={s.thunderbirdTxt}>Thunderbird School of Global Management at Arizona State University is the world's leading institution for global management education. Founded in 1946, Thunderbird has shaped generations of global leaders across 150+ countries. The school's mission is to educate, connect, and empower the next generation of global leaders who will make the world a better place through principled leadership and business.</Text>
        </View>

        {/* Built by */}
        <View style={s.builtCard}>
          <Feather name="heart" size={16} color="#FF3B30" />
          <Text style={s.builtTxt}>Built with pride by and for the Thunderbird community.</Text>
        </View>

        {/* Links */}
        <View style={s.links}>
          <TouchableOpacity style={s.link} onPress={() => navigation.navigate('Terms')}>
            <Text style={s.linkTxt}>Terms of Service</Text>
            <Feather name="chevron-right" size={16} color="#C7C7CC" />
          </TouchableOpacity>
          <View style={s.linkDivider} />
          <TouchableOpacity style={s.link} onPress={() => navigation.navigate('PrivacyPolicy')}>
            <Text style={s.linkTxt}>Privacy Policy</Text>
            <Feather name="chevron-right" size={16} color="#C7C7CC" />
          </TouchableOpacity>
          <View style={s.linkDivider} />
          <TouchableOpacity style={s.link} onPress={() => Linking.openURL('mailto:support@PlatinumCirclesnest.app')}>
            <Text style={s.linkTxt}>Contact Us</Text>
            <Feather name="chevron-right" size={16} color="#C7C7CC" />
          </TouchableOpacity>
        </View>

        <Text style={s.copyright}>© 2025 PlatinumCircles. All rights reserved.{'\n'}Thunderbird School of Global Management · ASU</Text>
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
  hero: { alignItems: 'center', paddingVertical: 32 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center', marginBottom: 14, shadowColor: '#007AFF', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  logoTxt: { fontSize: 40, fontWeight: '800', color: '#FFF' },
  appName: { fontSize: 28, fontWeight: '800', color: '#000', letterSpacing: -0.5, marginBottom: 6 },
  tagline: { fontSize: 15, color: '#8E8E93', textAlign: 'center', marginBottom: 14 },
  versionRow: { flexDirection: 'row' },
  versionPill: { backgroundColor: '#F2F2F7', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
  versionTxt: { fontSize: 13, color: '#8E8E93', fontWeight: '500' },
  missionCard: { backgroundColor: '#EFF6FF', borderRadius: 16, padding: 18, marginBottom: 28 },
  missionTitle: { fontSize: 17, fontWeight: '700', color: '#000', marginBottom: 8 },
  missionTxt: { fontSize: 15, color: '#1D4ED8', lineHeight: 24 },
  featuresTitle: { fontSize: 18, fontWeight: '700', color: '#000', marginBottom: 14 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 18 },
  featureIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  featureLabel: { fontSize: 15, fontWeight: '700', color: '#000', marginBottom: 3 },
  featureDesc: { fontSize: 14, color: '#3C3C43', lineHeight: 20 },
  featureInfo: { flex: 1 },
  thunderbirdCard: { backgroundColor: '#F5F5F5', borderRadius: 16, padding: 18, marginTop: 10, marginBottom: 16 },
  thunderbirdTitle: { fontSize: 16, fontWeight: '700', color: '#000', marginBottom: 8 },
  thunderbirdTxt: { fontSize: 14, color: '#3C3C43', lineHeight: 22 },
  builtCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  builtTxt: { fontSize: 14, color: '#3C3C43', fontWeight: '500' },
  links: { backgroundColor: '#F5F5F5', borderRadius: 14, overflow: 'hidden', marginTop: 8 },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  linkTxt: { fontSize: 16, color: '#000' },
  linkDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E5EA', marginLeft: 16 },
  copyright: { textAlign: 'center', fontSize: 12, color: '#C7C7CC', marginTop: 20, lineHeight: 18 },
});