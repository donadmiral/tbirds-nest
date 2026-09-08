/**
 * Add Yours: a prompt others answer with their own story. Tapping Add yours
 * opens the composer with this prompt already placed, and every join is counted.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
const PEARL = '#C9BFB0';
export default function AddYoursStickerCard({ prompt, interactive, isOwn, joined, joinedCount = 0, onJoin, onViewJoined }: { prompt: string; interactive?: boolean; isOwn?: boolean; joined?: boolean; joinedCount?: number; onJoin?: () => void; onViewJoined?: () => void }) {
  return (
    <View style={cs.card}>
      <View style={cs.headRow}><Feather name="layers" size={12} color={PEARL} /><Text style={cs.kicker}>ADD YOURS</Text></View>
      <Text style={cs.prompt} numberOfLines={3}>{prompt || 'Add yours'}</Text>
      {interactive && !isOwn ? (
        <TouchableOpacity onPress={onJoin} activeOpacity={0.85} style={[cs.btn, joined && cs.btnOn]} disabled={joined}>
          <Feather name={joined ? 'check' : 'plus'} size={13} color={joined ? '#0B1E3D' : PEARL} />
          <Text style={[cs.btnTxt, joined && { color: '#0B1E3D' }]}>{joined ? 'You joined' : 'Add yours'}</Text>
        </TouchableOpacity>
      ) : null}
      {interactive && isOwn ? (
        <TouchableOpacity onPress={onViewJoined} activeOpacity={0.8}><Text style={cs.count}>{joinedCount} {joinedCount === 1 ? 'person joined' : 'people joined'}</Text></TouchableOpacity>
      ) : !interactive ? <Text style={cs.count}>Others can add theirs</Text> : <Text style={cs.count}>{joinedCount} joined</Text>}
    </View>
  );
}
const cs = StyleSheet.create({
  card: { width: 236, backgroundColor: 'rgba(10,14,26,0.92)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: 'rgba(201,191,176,0.4)', alignItems: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  kicker: { color: PEARL, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  prompt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11, backgroundColor: 'rgba(201,191,176,0.14)', borderWidth: 1, borderColor: 'rgba(201,191,176,0.55)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  btnOn: { backgroundColor: PEARL, borderColor: PEARL },
  btnTxt: { color: PEARL, fontSize: 12.5, fontWeight: '800' },
  count: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', marginTop: 9 },
});