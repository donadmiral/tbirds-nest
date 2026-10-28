import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { postCaptionAt, type PostCaptionCue } from '../../shared/postMediaEditing';

export default function PostCaption({ captions, time, preview }: { captions?: PostCaptionCue[] | null; time: number; preview?: PostCaptionCue | null }) {
  const cue = preview ?? postCaptionAt(captions, time);
  if (!cue?.text) return null;
  return <View pointerEvents="none" style={[styles.layer, cue.position === 'top' ? { top: '10%' } : cue.position === 'middle' ? { top: '44%' } : { bottom: '16%' }]}>
    <Text style={[styles.text, cue.style === 'clean' && styles.clean, cue.style === 'bold' && styles.bold, cue.style === 'highlight' && styles.highlight]}>{cue.text}</Text>
  </View>;
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: '8%', right: '8%', alignItems: 'center', zIndex: 4 },
  text: { overflow: 'hidden', paddingHorizontal: 11, paddingVertical: 7, textAlign: 'center', color: '#FFFFFF', fontSize: 20, lineHeight: 27, borderRadius: 5, textShadowColor: 'rgba(0,0,0,.6)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } },
  clean: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', backgroundColor: 'rgba(0,0,0,.58)' },
  bold: { fontWeight: '800', backgroundColor: 'rgba(0,0,0,.5)' },
  highlight: { fontWeight: '700', color: '#10213E', backgroundColor: '#F0E4CE', textShadowRadius: 0 },
});
