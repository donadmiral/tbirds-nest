/**
 * CountdownStickerCard — a live-ticking countdown on a story.
 * Stores a target timestamp, never a string: the card computes remaining
 * time every second. Viewers tap Remind me and get a local notification
 * when it ends; the owner sees how many reminders were set.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

const AMBER = '#F59E0B';

function parts(target: string | null) {
  if (!target) return null;
  const t = new Date(target).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = t - Date.now();
  if (diff <= 0) return { ended: true, d: 0, h: 0, m: 0, s: 0 };
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { ended: false, d, h, m, s };
}

function Cell({ v, l }: { v: number; l: string }) {
  return (
    <View style={cs.cell}>
      <Text style={cs.cellV}>{String(v).padStart(2, '0')}</Text>
      <Text style={cs.cellL}>{l}</Text>
    </View>
  );
}

export default function CountdownStickerCard({ title, target, interactive, isOwn, reminded, reminderCount, onRemind }: {
  title: string;
  target: string | null;
  interactive?: boolean;
  isOwn?: boolean;
  reminded?: boolean;
  reminderCount?: number;
  onRemind?: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const p = parts(target);

  return (
    <View style={cs.card}>
      <View style={cs.headRow}>
        <Feather name="clock" size={12} color={AMBER} />
        <Text style={cs.title} numberOfLines={2}>{title || 'Countdown'}</Text>
      </View>
      {p ? (
        p.ended ? (
          <Text style={cs.ended}>It happened 🎉</Text>
        ) : (
          <View style={cs.cells}>
            {p.d > 0 ? <Cell v={p.d} l="DAYS" /> : null}
            <Cell v={p.h} l="HRS" />
            <Cell v={p.m} l="MIN" />
            {p.d === 0 ? <Cell v={p.s} l="SEC" /> : null}
          </View>
        )
      ) : null}
      {interactive && !isOwn && p && !p.ended ? (
        reminded ? (
          <View style={[cs.remindBtn, cs.remindOn]}>
            <Feather name="check" size={12} color="#0B1E3D" />
            <Text style={[cs.remindTxt, { color: '#0B1E3D' }]}>Reminder set</Text>
          </View>
        ) : (
          <TouchableOpacity style={cs.remindBtn} onPress={onRemind} activeOpacity={0.85}>
            <Feather name="bell" size={12} color={AMBER} />
            <Text style={cs.remindTxt}>Remind me</Text>
          </TouchableOpacity>
        )
      ) : null}
      {isOwn && (reminderCount ?? 0) > 0 ? (
        <Text style={cs.ownCount}>{reminderCount} {reminderCount === 1 ? 'reminder' : 'reminders'} set</Text>
      ) : null}
    </View>
  );
}

const cs = StyleSheet.create({
  card: { width: 236, backgroundColor: 'rgba(10,14,26,0.92)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 9 },
  title: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
  cells: { flexDirection: 'row', gap: 7 },
  cell: { backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, alignItems: 'center', minWidth: 46 },
  cellV: { color: '#FFFFFF', fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  cellL: { color: 'rgba(255,255,255,0.55)', fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8, marginTop: 1 },
  ended: { color: AMBER, fontSize: 15, fontWeight: '800', paddingVertical: 4 },
  remindBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11, backgroundColor: 'rgba(245,158,11,0.14)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.5)', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  remindOn: { backgroundColor: AMBER, borderColor: AMBER },
  remindTxt: { color: AMBER, fontSize: 12, fontWeight: '800' },
  ownCount: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', marginTop: 9 },
});
