import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import StickerIcon from './StickerIcons';

/** A visual label for a gallery choice. The editor supplies the actual content. */
export default function StickerGalleryPreview({ id, label }: { id: string; label: string }) {
  if (id === 'poll' || id === 'quiz') return <View style={s.card}><Text style={s.title}>{id === 'poll' ? 'Ask your circle' : 'Pick an answer'}</Text><View style={s.answers}><View style={[s.answer, s.peach]}><Text style={s.small}>A</Text></View><View style={[s.answer, s.sage]}><Text style={s.small}>B</Text></View></View></View>;
  if (id === 'question') return <View style={[s.card, s.peach]}><Feather name="message-circle" size={17} color="#202326" /><Text style={s.title}>Ask me anything</Text><View style={s.field}><Text style={s.hint}>Type something…</Text></View></View>;
  if (id === 'slider') return <View style={s.card}><Text style={s.title}>How do you feel?</Text><View style={s.sliderRow}><Text style={{ fontSize: 24 }}>♥</Text><View style={s.track}><View style={s.fill} /><View style={s.knob} /></View></View></View>;
  if (id === 'countdown') return <View style={[s.card, s.sage]}><Text style={s.title}>Count down to it</Text><View style={s.answers}>{['DD', 'HH', 'MM'].map(t => <View key={t} style={s.digit}><Text style={s.small}>{t}</Text></View>)}</View></View>;
  if (id === 'time') return <View style={s.clear}><Text style={s.time}>12:00</Text><Text style={s.spaced}>YOUR MOMENT</Text></View>;
  if (id === 'photo') return <View style={s.photo}><Feather name="image" size={28} color="#8A9387" /><Text style={s.small}>Your photo</Text></View>;
  return <View style={[s.pill, id === 'mention' && s.sage, id === 'link' && s.glass]}><StickerIcon name={id as any} size={22} color={id === 'link' ? '#FFFFFF' : id === 'mention' ? '#D3664F' : '#202326'} bg="transparent" /><Text numberOfLines={2} style={[s.title, { flexShrink: 1 }, id === 'link' && { color: '#FFFFFF' }]}>{id === 'mention' ? '@ mention' : label}</Text></View>;
}
const s = StyleSheet.create({
  card: { width: '100%', minHeight: 104, borderRadius: 20, backgroundColor: '#FAF6EE', padding: 12, gap: 9, justifyContent: 'center', alignItems: 'center' },
  pill: { width: '100%', minHeight: 64, borderRadius: 23, backgroundColor: '#FAF6EE', paddingHorizontal: 12, paddingVertical: 14, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#202326', fontWeight: '700', fontSize: 13, textAlign: 'center' }, small: { color: '#202326', fontSize: 12, fontWeight: '600' },
  peach: { backgroundColor: '#F5B09A' }, sage: { backgroundColor: '#C4CFB5' }, glass: { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' },
  answers: { flexDirection: 'row', width: '100%', gap: 5 }, answer: { flex: 1, minHeight: 30, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  field: { width: '100%', backgroundColor: 'rgba(255,255,255,0.48)', paddingVertical: 9, borderRadius: 9, alignItems: 'center' }, hint: { color: '#595958', fontSize: 10 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 9, width: '100%' }, track: { flex: 1, height: 7, borderRadius: 5, backgroundColor: '#DDDAD5' }, fill: { width: '60%', height: 7, backgroundColor: '#F78D76', borderRadius: 5 }, knob: { position: 'absolute', left: '52%', top: -4, width: 15, height: 15, borderRadius: 8, borderWidth: 2, borderColor: '#FFF', backgroundColor: '#F78D76' },
  digit: { flex: 1, minHeight: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAF6EE', borderRadius: 5 }, clear: { alignItems: 'center', gap: 4 }, time: { fontSize: 31, color: '#FFFFFF', fontWeight: '800' }, spaced: { color: '#C3C7CB', fontSize: 8, letterSpacing: 2 },
  photo: { minHeight: 98, width: 110, borderWidth: 7, borderBottomWidth: 18, borderColor: '#FAF6EE', backgroundColor: '#D8DFD3', alignItems: 'center', justifyContent: 'center', gap: 5, transform: [{ rotate: '-5deg' }] },
});
