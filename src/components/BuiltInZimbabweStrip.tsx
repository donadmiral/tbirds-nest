import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Pinned masthead for the Innovation tab.
// Editorial treatment: no card, no icon. Flag-color ribbon tucked under "Zimbabwe",
// rotated slightly so it reads hand-placed rather than templated.
export default function BuiltInZimbabweStrip() {
  return (
    <View style={st.wrap}>
      <Text style={st.eyebrow}>PINNED · INNOVATION</Text>
      <View style={st.headlineRow}>
        <Text style={st.headline}>Built in </Text>
        <View>
          <View style={st.ribbon}>
            <View style={[st.ribbonBand, { backgroundColor: '#319E45' }]} />
            <View style={[st.ribbonBand, { backgroundColor: '#FFD200' }]} />
            <View style={[st.ribbonBand, { backgroundColor: '#DE2010' }]} />
            <View style={[st.ribbonBand, { backgroundColor: '#0A0A0A' }]} />
          </View>
          <Text style={st.headline}>Zimbabwe</Text>
        </View>
      </View>
      <Text style={st.sub}>New inventions and improvements, from home.</Text>
      <View style={st.rule} />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 2 },
  eyebrow: {
    fontSize: 10, fontWeight: '700', color: '#8E9BAE',
    letterSpacing: 1.6, marginBottom: 6,
  },
  headlineRow: { flexDirection: 'row', alignItems: 'flex-end' },
  headline: {
    fontSize: 24, fontWeight: '900', color: '#0A0A0A', letterSpacing: -0.8,
  },
  ribbon: {
    position: 'absolute', left: -2, right: -4, bottom: 3, height: 9,
    flexDirection: 'row', borderRadius: 2, overflow: 'hidden',
    transform: [{ rotate: '-1deg' }], opacity: 0.9,
  },
  ribbonBand: { flex: 1 },
  sub: { fontSize: 12.5, color: '#6B7280', marginTop: 6, fontWeight: '500' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB', marginTop: 12 },
});