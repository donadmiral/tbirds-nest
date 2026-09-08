/**
 * Frame: a Polaroid. In a story the photo stays hidden under the film until
 * the viewer taps it; in the composer it shows so it can be placed.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
export default function FrameStickerCard({ uri, caption, interactive }: { uri?: string | null; caption?: string; interactive?: boolean }) {
  const [revealed, setRevealed] = useState(!interactive);
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={() => interactive && setRevealed(true)} disabled={!interactive} style={cs.frame}>
      <View style={cs.photo}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        {!revealed ? <View style={cs.film}><Text style={cs.filmTxt}>Tap to reveal</Text></View> : null}
      </View>
      <Text style={cs.caption} numberOfLines={1}>{caption || ' '}</Text>
    </TouchableOpacity>
  );
}
const cs = StyleSheet.create({
  frame: { width: 200, backgroundColor: '#FFFFFF', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 14, borderRadius: 4, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  photo: { width: 180, height: 180, backgroundColor: '#111', overflow: 'hidden' },
  film: { ...StyleSheet.absoluteFillObject, backgroundColor: '#15161A', alignItems: 'center', justifyContent: 'center' },
  filmTxt: { color: 'rgba(255,255,255,0.75)', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.5 },
  caption: { color: '#0B1E3D', fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
});