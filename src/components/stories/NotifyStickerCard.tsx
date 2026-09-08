/**
 * Notify: people opt in to be told when something happens; the owner sends
 * the notification to everyone who did, with one tap, when the moment comes.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
const BLUE = '#7DB1FF';
export default function NotifyStickerCard({ title, when, interactive, isOwn, signed, signupCount = 0, onSignUp, onSend }: { title: string; when?: string | null; interactive?: boolean; isOwn?: boolean; signed?: boolean; signupCount?: number; onSignUp?: () => void; onSend?: () => void }) {
  const whenText = when ? new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  return (
    <View style={cs.card}>
      <View style={cs.headRow}><Feather name="bell" size={12} color={BLUE} /><Text style={cs.kicker}>NOTIFY ME</Text></View>
      <Text style={cs.title} numberOfLines={2}>{title || 'Notify'}</Text>
      {whenText ? <Text style={cs.when}>{whenText}</Text> : null}
      {interactive && !isOwn ? (
        <TouchableOpacity onPress={onSignUp} activeOpacity={0.85} disabled={signed} style={[cs.btn, signed && cs.btnOn]}>
          <Feather name={signed ? 'check' : 'bell'} size={13} color={signed ? '#0B1E3D' : BLUE} />
          <Text style={[cs.btnTxt, signed && { color: '#0B1E3D' }]}>{signed ? "You'll be notified" : 'Notify me'}</Text>
        </TouchableOpacity>
      ) : null}
      {interactive && isOwn ? (
        <TouchableOpacity onPress={onSend} activeOpacity={0.85} style={cs.btn}><Feather name="send" size={13} color={BLUE} /><Text style={cs.btnTxt}>{signupCount} signed up · Send now</Text></TouchableOpacity>
      ) : !interactive ? <Text style={cs.count}>People can ask to be notified</Text> : null}
    </View>
  );
}
const cs = StyleSheet.create({
  card: { width: 236, backgroundColor: 'rgba(10,14,26,0.92)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: 'rgba(125,177,255,0.4)', alignItems: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  kicker: { color: BLUE, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  when: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '700', marginTop: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11, backgroundColor: 'rgba(125,177,255,0.14)', borderWidth: 1, borderColor: 'rgba(125,177,255,0.55)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  btnOn: { backgroundColor: BLUE, borderColor: BLUE },
  btnTxt: { color: BLUE, fontSize: 12.5, fontWeight: '800' },
  count: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', marginTop: 9 },
});