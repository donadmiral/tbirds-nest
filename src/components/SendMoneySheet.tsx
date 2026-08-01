/**
 * SendMoneySheet - Apple Cash flow.
 * Link once, then: amount -> Pay or Request -> biometric confirm.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { paymentsService } from '../services/paymentsService';
import { flagsService } from '../services/flagsService';

const NAVY = '#0B1E3D';
const GREEN = '#2F9E63';

type Props = {
  visible: boolean;
  onClose: () => void;
  recipientId: string;
  recipientName: string;
  conversationId: string;
  onSent?: (amount: number, currency: string, txId: string) => void;
  onRequested?: (amount: number, currency: string) => void;
  /** When the payment is for a Market listing, so the record says what was bought. */
  listingId?: string | null;
  /** Pre-fills the keypad, e.g. a listing price. */
  initialAmount?: number | null;
};

const KEYS = ['1','2','3','4','5','6','7','8','9','.','0','del'];

export default function SendMoneySheet({
  visible, onClose, recipientId, recipientName, conversationId, onSent, onRequested, listingId, initialAmount,
}: Props) {
  const [checking, setChecking] = useState(true);
  const [linked, setLinked] = useState(false);
  const [peerHasBank, setPeerHasBank] = useState(false);
  useEffect(() => { if (visible && recipientId) { paymentsService.peerLinked(recipientId).then(setPeerHasBank, () => setPeerHasBank(false)); } else { setPeerHasBank(false); } }, [visible, recipientId]);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [wallet, setWallet] = useState<any>(null);
  const [raw, setRaw] = useState('0');
  const [busy, setBusy] = useState(false);
  // One key per intent, not per tap. A retry after a timeout reuses it, which is
  // what stops the bridge charging twice.
  const idemKeyRef = useRef<string>("");

  useEffect(() => {
    if (!visible) return;
    flagsService.isEnabled('payments').then(on => {
      if (!on) {
        Alert.alert('Payments unavailable', 'In-chat payments are temporarily switched off by Platinum Circles operations.');
        onClose();
      }
    }).catch(() => {});
    setChecking(true); setEmail(''); setOtp(''); setOtpSent(false);
    setRaw(initialAmount && initialAmount > 0 ? String(initialAmount) : '0');
    idemKeyRef.current =
      Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    paymentsService.getBalance()
      .then(r => { setLinked(!!r?.linked); setWallet(r?.linked ? r : null); })
      .catch(() => { setLinked(false); setWallet(null); })
      .finally(() => setChecking(false));
  }, [visible]);

  const amount = useMemo(() => Number(raw) || 0, [raw]);
  const fontSize = useMemo(() => {
    const len = raw.length;
    if (len <= 3) return 84;
    if (len <= 5) return 68;
    if (len <= 7) return 54;
    return 44;
  }, [raw]);

  const press = useCallback((k: string) => {
    setRaw(prev => {
      if (k === 'del') { const n = prev.slice(0, -1); return n === '' ? '0' : n; }
      if (k === '.') { return prev.includes('.') ? prev : prev + '.'; }
      if (prev === '0') return k;
      if (prev.includes('.') && prev.split('.')[1].length >= 2) return prev;
      if (prev.replace('.', '').length >= 8) return prev;
      return prev + k;
    });
  }, []);

  const adjust = useCallback((d: number) => {
    setRaw(prev => {
      const next = Math.max(0, (Number(prev) || 0) + d);
      return String(Number(next.toFixed(2)));
    });
  }, []);

  const doLink = useCallback(async () => {
    setBusy(true);
    try {
      if (!otpSent) {
        if (!email.trim()) { Alert.alert('Sign in', 'Enter your IntoBank email.'); return; }
        const r = await paymentsService.sendOtp(email.trim());
        if (r?.success) setOtpSent(true);
        else Alert.alert('Could not send code', r?.error || 'Check the email and try again.');
      } else {
        if (!otp.trim()) { Alert.alert('Enter the code', 'Check your email for the code.'); return; }
        const r = await paymentsService.verifyOtp(email.trim(), otp.trim());
        if (r?.success) { setLinked(true); setEmail(''); setOtp(''); setOtpSent(false); }
        else Alert.alert('Could not connect', r?.error || 'Check the code and try again.');
      }
    } catch (e: any) {
      Alert.alert(otpSent ? 'Could not connect' : 'Could not send code', e?.message || 'Please try again.');
    } finally { setBusy(false); }
  }, [email, otp, otpSent]);

  const doPay = useCallback(async () => {
    if (amount <= 0) return;
    setBusy(true);
    try {
      const r = await paymentsService.sendMoney({
        recipientId, amount, conversationId,
        listingId: listingId ?? null,
        idempotencyKey: idemKeyRef.current,
      });
      if (r?.success) { onSent?.(amount, r.currency || 'USD', r.tx_id); onClose(); }
      else Alert.alert('Not sent', r?.error || 'Please try again.');
    } catch (e: any) {
      Alert.alert('Not sent', e?.message || 'Please try again.');
    } finally { setBusy(false); }
  }, [amount, recipientId, conversationId, onSent, onClose]);

  const doRequest = useCallback(() => {
    if (amount <= 0) return;
    onRequested?.(amount, 'USD');
    onClose();
  }, [amount, onRequested, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={s.dismiss} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.handle} />

          {checking ? (
            <View style={s.center}><ActivityIndicator color={NAVY} /></View>
          ) : !linked ? (
            <View style={s.pad}>
              <View style={s.linkIcon}><Feather name="link" size={22} color={NAVY} /></View>
              <Text style={s.linkTitle}>Connect IntoBank</Text>
              <Text style={s.linkSub}>Enter your IntoBank email and we will send you a code. This happens once.</Text>
              <TextInput
                style={s.field}
                value={email}
                onChangeText={setEmail}
                placeholder="IntoBank email"
                placeholderTextColor="#B0B0B5"
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
              {otpSent && (
                <TextInput
                  style={s.field}
                  value={otp}
                  onChangeText={setOtp}
                  placeholder="6-digit code"
                  placeholderTextColor="#B0B0B5"
                  keyboardType="number-pad"
                  maxLength={6}
                />
              )}
              <TouchableOpacity style={[s.cta, busy && s.off]} onPress={doLink} disabled={busy} activeOpacity={0.85}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.ctaTxt}>{otpSent ? 'Verify and connect' : 'Send code'}</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Text style={s.to}>To {recipientName}</Text>{peerHasBank ? <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E9F2EE', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, gap: 3 }}><View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: '#0A3D2E', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#C8963E', fontSize: 9, fontWeight: '900' }}>I</Text></View><Text style={{ fontSize: 10.5, fontWeight: '700', color: '#0A3D2E' }}>IntoBank</Text></View> : null}</View>
              {!!wallet && (
                <View style={s.fundRow}>
                  <Feather name="credit-card" size={12} color="#8E8E93" />
                  <Text style={s.fundTxt} numberOfLines={1}>
                    {(wallet.email || 'IntoBank') + '  ·  ' + (wallet.currency || 'USD') + ' ' + Number(wallet.available ?? 0).toFixed(2) + ' available'}
                  </Text>
                </View>
              )}

              <View style={s.amountRow}>
                <TouchableOpacity style={s.step} onPress={() => adjust(-1)} activeOpacity={0.7}>
                  <Feather name="minus" size={18} color="#3C3C43" />
                </TouchableOpacity>
                <View style={s.amountWrap}>
                  <Text style={[s.amount, { fontSize }]} numberOfLines={1} adjustsFontSizeToFit>
                    ${raw}
                  </Text>
                </View>
                <TouchableOpacity style={s.step} onPress={() => adjust(1)} activeOpacity={0.7}>
                  <Feather name="plus" size={18} color="#3C3C43" />
                </TouchableOpacity>
              </View>

              <View style={s.keypad}>
                {KEYS.map(k => (
                  <TouchableOpacity key={k} style={s.key} onPress={() => press(k)} activeOpacity={0.6}>
                    {k === 'del'
                      ? <Feather name="delete" size={22} color="#0A0A0A" />
                      : <Text style={s.keyTxt}>{k}</Text>}
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.actions}>
                <TouchableOpacity
                  style={[s.request, amount <= 0 && s.off]}
                  onPress={doRequest}
                  disabled={amount <= 0 || busy}
                  activeOpacity={0.85}
                >
                  <Text style={s.requestTxt}>Request</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.pay, (amount <= 0 || busy) && s.off]}
                  onPress={doPay}
                  disabled={amount <= 0 || busy || (!!wallet && (amount > Number(wallet.available ?? 0) || (wallet.per_tx_max != null && amount > Number(wallet.per_tx_max))))}
                  activeOpacity={0.85}
                >
                  {busy ? <ActivityIndicator color="#FFF" /> : (
                    <>
                      <Feather name="lock" size={14} color="#FFF" />
                      <Text style={s.payTxt}>Pay</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D8D8DC', alignSelf: 'center', marginBottom: 14 },
  center: { paddingVertical: 50, alignItems: 'center' },
  pad: { paddingBottom: 8 },
  linkIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  linkTitle: { fontSize: 20, fontWeight: '800', color: '#0A0A0A', letterSpacing: -0.5, textAlign: 'center', marginTop: 12 },
  linkSub: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 6, lineHeight: 20, paddingHorizontal: 10 },
  field: { marginTop: 12, backgroundColor: '#F2F2F7', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15, fontSize: 16, fontWeight: '500', color: '#0A0A0A' },
  to: { fontSize: 14, fontWeight: '600', color: '#8E8E93', textAlign: 'center', marginBottom: 4 },
  fundRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 2 },
  fundTxt: { fontSize: 12.5, fontWeight: '500', color: '#8E8E93' },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  amountWrap: { flex: 1, alignItems: 'center' },
  amount: { fontWeight: '800', color: '#0A0A0A', letterSpacing: -2.5 },
  step: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  key: { width: '33.33%', height: 58, alignItems: 'center', justifyContent: 'center' },
  keyTxt: { fontSize: 27, fontWeight: '500', color: '#0A0A0A' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  request: { flex: 1, backgroundColor: '#F2F2F7', borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  requestTxt: { color: NAVY, fontSize: 16, fontWeight: '700' },
  pay: { flex: 1, flexDirection: 'row', gap: 8, backgroundColor: NAVY, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  payTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  off: { opacity: 0.4 },
  cta: { backgroundColor: NAVY, borderRadius: 16, paddingVertical: 16, marginTop: 16, alignItems: 'center' },
  ctaTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
