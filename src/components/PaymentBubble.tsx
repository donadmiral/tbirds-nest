/**
 * PaymentBubble
 *
 * A transfer in a chat thread. Deliberately not a message bubble: money moving
 * between two people should not look like a sentence, which is the whole reason
 * Apple Cash renders it as a card.
 *
 * Currency-neutral by design. This app carries USD and ZWG, so a dollar glyph
 * would be wrong half the time; the amount states its own currency instead.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

export type ChatPayment = {
  payment_id: string;
  sender_id: string;
  recipient_id: string;
  amount: number | string;
  currency: string | null;
  status: string;
  note: string | null;
  listing_id: string | null;
  listing_title: string | null;
  created_at: string;
  completed_at: string | null;
};

const NAVY = '#0B1E3D';
const GREEN = '#2F9E63';
const PLATINUM = '#C9BFB0';

function money(amount: number | string, currency?: string | null) {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(n)) return String(amount);
  const body = n.toFixed(2).replace(/\.00$/, '');
  return (currency || 'USD') === 'USD' ? `$${body}` : `ZWG ${body}`;
}

export default function PaymentBubble({
  payment, isMine, otherName,
}: { payment: ChatPayment; isMine: boolean; otherName?: string | null }) {
  const done = payment.status === 'completed';
  const heading = isMine
    ? (done ? 'You sent' : 'Sending')
    : `${otherName || 'They'} sent you`;

  return (
    <View style={[s.card, isMine ? s.cardMine : s.cardTheirs]}>
      <View style={s.top}>
        <View style={[s.badge, isMine ? s.badgeMine : s.badgeTheirs]}>
          <Feather
            name={isMine ? 'arrow-up-right' : 'arrow-down-left'}
            size={13}
            color={isMine ? NAVY : '#FFFFFF'}
          />
        </View>
        <Text style={[s.heading, isMine ? s.headingMine : s.textTheirs]} numberOfLines={1}>
          {heading}
        </Text>
      </View>

      <Text style={[s.amount, isMine ? s.textMine : s.textTheirs]}>
        {money(payment.amount, payment.currency)}
      </Text>

      {payment.listing_title ? (
        <Text style={[s.sub, isMine ? s.subMine : s.subTheirs]} numberOfLines={1}>
          for {payment.listing_title}
        </Text>
      ) : payment.note ? (
        <Text style={[s.sub, isMine ? s.subMine : s.subTheirs]} numberOfLines={2}>
          {payment.note}
        </Text>
      ) : null}

      <View style={s.foot}>
        <Feather
          name={done ? 'check-circle' : 'clock'}
          size={11}
          color={isMine ? 'rgba(255,255,255,0.75)' : GREEN}
        />
        <Text style={[s.status, isMine ? s.subMine : { color: GREEN }]}>
          {done ? 'Completed' : 'Pending'}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { minWidth: 190, maxWidth: 250, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, gap: 2 },
  cardMine: { backgroundColor: NAVY, borderWidth: 1, borderColor: 'rgba(201,191,176,0.55)' },
  cardTheirs: { backgroundColor: '#EAF6EF', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(47,158,99,0.35)' },

  top: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 2 },
  badge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  badgeMine: { backgroundColor: PLATINUM },
  badgeTheirs: { backgroundColor: GREEN },
  heading: { flex: 1, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },

  amount: { fontSize: 30, fontWeight: '800', letterSpacing: -1 },
  textMine: { color: '#FFFFFF' },
  headingMine: { color: PLATINUM },
  textTheirs: { color: NAVY },

  sub: { fontSize: 12, marginTop: 1 },
  subMine: { color: 'rgba(255,255,255,0.75)' },
  subTheirs: { color: 'rgba(11,30,61,0.62)' },

  foot: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  status: { fontSize: 11, fontWeight: '600' },
});