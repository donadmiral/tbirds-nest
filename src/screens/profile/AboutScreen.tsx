/**
 * AboutScreen - what Platinum Circles is, in its own words.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

const NAVY = '#0B1E3D';
const PLATINUM = '#C9BFB0';
const VERSION = '1.0.0';
const BUILD = '100';

export default function AboutScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>About Platinum Circles</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom + 110, 130) }]}>

        <View style={s.hero}>
          <View style={s.mark}>
            <View style={s.ring} />
            <View style={s.pearl} />
          </View>
          <Text style={s.appName}>Platinum Circles</Text>
          <Text style={s.tagline}>Zimbabwe's professional network</Text>
          <View style={s.versionPill}><Text style={s.versionTxt}>Version {VERSION} ({BUILD})</Text></View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Our mission</Text>
          <Text style={s.body}>Platinum Circles exists so that Zimbabweans can find work, trade, build, and stay connected in one place made for us. The talent has always been here. We are building the network it deserves - where a job application, a sale, a story, and a call all happen with the people who matter to you.</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>What lives here</Text>
          <Text style={s.body}>A feed for your circles, with stories that disappear in a day and a Trending page that only shows what real people have genuinely lifted up. Messages with voice notes and voice and video calls. A Market where you deal directly with the seller. A Jobs board built for how hiring works here - apply with your CV, your phone number, and your portfolio. And the Innovation channel: a registry of what Zimbabwe is building in science, engineering, and enterprise, and the people building it.</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>The mark</Text>
          <Text style={s.body}>Our symbol is a pearl set in a platinum ring. Platinum for the standard we hold ourselves to. The pearl at the center honors Pearl - the founder's mother - because everything built here is built on what she gave.</Text>
        </View>

        <Text style={s.foot}>Made with pride, for Zimbabwe.</Text>
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
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  hero: { alignItems: 'center', paddingVertical: 26 },
  mark: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  ring: { position: 'absolute', width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: PLATINUM },
  pearl: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F3EFE7', borderWidth: 1, borderColor: 'rgba(11,30,61,0.12)' },
  appName: { fontSize: 24, fontWeight: '800', color: NAVY, letterSpacing: -0.5 },
  tagline: { fontSize: 13.5, color: 'rgba(11,30,61,0.55)', marginTop: 4 },
  versionPill: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99, backgroundColor: 'rgba(11,30,61,0.06)' },
  versionTxt: { fontSize: 12, fontWeight: '600', color: 'rgba(11,30,61,0.6)' },
  card: { backgroundColor: 'rgba(11,30,61,0.035)', borderRadius: 16, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 14.5, fontWeight: '800', color: NAVY, marginBottom: 8 },
  body: { fontSize: 13.5, lineHeight: 21, color: 'rgba(11,30,61,0.8)' },
  foot: { textAlign: 'center', fontSize: 12.5, color: 'rgba(11,30,61,0.45)', marginTop: 16 },
});