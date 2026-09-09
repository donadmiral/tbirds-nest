/**
 * Results: the final numbers of a quiz or a poll, shared as a new story on
 * any background. Bars, percentages, a tick on the right answer, the total.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
export default function ResultsStickerCard({ title, rows, total }: { title: string; rows: { label: string; pct: number; correct?: boolean }[]; total?: number }) {
  return (
    <View style={cs.card}>
      <Text style={cs.kicker}>RESULTS</Text>
      <Text style={cs.title} numberOfLines={2}>{title}</Text>
      <View style={{ gap: 6, marginTop: 8 }}>
        {rows.map((r, i) => (
          <View key={i} style={cs.row}>
            <View style={[cs.fill, { width: (Math.max(4, Math.round(r.pct)) + '%') as any, backgroundColor: r.correct ? 'rgba(52,199,89,0.28)' : 'rgba(11,30,61,0.12)' }]} />
            <View style={cs.rowInner}>
              {r.correct ? <Feather name="check-circle" size={13} color="#1D7A38" /> : null}
              <Text style={[cs.label, r.correct && { color: '#1D7A38' }]} numberOfLines={1}>{r.label}</Text>
              <Text style={cs.pct}>{Math.round(r.pct)}%</Text>
            </View>
          </View>
        ))}
      </View>
      {typeof total === 'number' ? <Text style={cs.total}>{total} {total === 1 ? 'response' : 'responses'}</Text> : null}
    </View>
  );
}
const cs = StyleSheet.create({
  card: { width: 250, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  kicker: { color: 'rgba(11,30,61,0.5)', fontSize: 9.5, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  title: { color: '#0B1E3D', fontSize: 15, fontWeight: '800', textAlign: 'center', marginTop: 3 },
  row: { height: 36, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.05)', overflow: 'hidden', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10 },
  label: { flex: 1, color: '#0B1E3D', fontSize: 13.5, fontWeight: '700' },
  pct: { color: '#0B1E3D', fontSize: 13, fontWeight: '800' },
  total: { color: 'rgba(11,30,61,0.5)', fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: 8 },
});