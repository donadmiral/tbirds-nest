/**
 * SendMoneySheet - Apple Cash flow.
 * Link once, then: amount -> Pay or Request -> biometric confirm.
 */
import { themedSheet } from '../theme/useTheme';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { paymentsService } from '../services/paymentsService';
import type { PaymentIntent, PaymentOutcome } from '../services/paymentIntent';
import { flagsService } from '../services/flagsService';
import { useAuthStore } from '../stores/authStore';

const NAVY = '#0B1E3D';

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
  const ownerId = useAuthStore(st => st.session?.user?.id || '');
  const [checking, setChecking] = useState(true);
  const [linked, setLinked] = useState(false);
  const [peerHasBank, setPeerHasBank] = useState(false);
  const [code, setCode] = useState('');
  const [wallet, setWallet] = useState<any>(null);
  const [raw, setRaw] = useState('0');
  const [busy, setBusy] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<PaymentIntent | null>(null);
  const [retryAllowed, setRetryAllowed] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const operationRef = useRef(false);
  const context = [ownerId, conversationId, recipientId].join(':');
  const activeContextRef = useRef('');
  activeContextRef.current = visible ? context : '';

  const showOutcome = useCallback(async (intent: PaymentIntent, outcome: PaymentOutcome) => {
    if (outcome.status === 'completed' && outcome.tx_id) {
      await paymentsService.clearIntent(intent);
      if (activeContextRef.current !== context) return;
      setPendingIntent(null);
      onSent?.(intent.amount, outcome.currency || intent.currency, outcome.tx_id);
      onClose();
      return;
    }
    if (outcome.status === 'failed') {
      await paymentsService.clearIntent(intent);
      if (activeContextRef.current !== context) return;
      setPendingIntent(null);
      setRetryAllowed(false);
      setRaw('0');
      setRecoveryMessage(outcome.error || 'The payment was declined. No new payment has been sent.');
      return;
    }
    if (activeContextRef.current !== context) return;
    setPendingIntent(intent);
    setRaw(String(intent.amount));
    setRetryAllowed(outcome.status === 'not_found');
    setRecoveryMessage(outcome.status === 'not_found'
      ? 'No payment record was found. You may confirm a retry of this same payment. Its reference and amount will stay the same.'
      : outcome.status === 'not_submitted'
        ? outcome.error || 'Confirmation was cancelled. Check the saved payment before retrying.'
        : 'Payment outcome unconfirmed. Check its status before making another payment. Closing this sheet keeps the original reference.');
  }, [context, onSent, onClose]);

  // Reopening a sheet only reads status. It never sends or creates a new key.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const current = () => !cancelled && activeContextRef.current === context;
    setChecking(true); setCode(''); setLoadError(''); setRecoveryMessage('');
    setPendingIntent(null); setRetryAllowed(false); setWallet(null); setLinked(false); setPeerHasBank(false);
    setRaw(initialAmount && initialAmount > 0 ? String(initialAmount) : '0');
    (async () => {
      try {
        if (!ownerId) throw new Error('Sign in before opening a payment.');
        const intent = await paymentsService.getPendingIntent({ ownerId, recipientId, conversationId });
        if (!current()) return;
        if (intent) {
          setPendingIntent(intent); setRaw(String(intent.amount));
          try {
            const result = await paymentsService.getPaymentStatus(intent);
            if (!current()) return;
            await showOutcome(intent, result);
          } catch {
            if (current()) setRecoveryMessage('Payment outcome unconfirmed. Reconnect and check its status. The original payment reference is saved.');
          }
        }
        const [balance, peer] = await Promise.all([
          paymentsService.getBalance(), paymentsService.peerLinked(recipientId),
        ]);
        if (!current()) return;
        setLinked(!!balance?.linked); setWallet(balance?.linked ? balance : null); setPeerHasBank(peer);
        const enabled = await flagsService.isEnabled('payments');
        if (current() && !enabled) setLoadError('New chat payments are temporarily unavailable. You can still check a saved payment.');
      } catch (e: any) {
        if (current()) setLoadError(e?.message || 'Could not load payment details. Close this sheet and try again.');
      } finally { if (current()) setChecking(false); }
    })();
    return () => { cancelled = true; };
    // Callback identity changes from the parent must not reset an open payment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ownerId, recipientId, conversationId]);

  const amount = useMemo(() => Number(raw) || 0, [raw]);
  const fontSize = useMemo(() => {
    const len = raw.length;
    if (len <= 3) return 84;
    if (len <= 5) return 68;
    if (len <= 7) return 54;
    return 44;
  }, [raw]);

  const press = useCallback((k: string) => {
    if (pendingIntent || busy) return;
    setRaw(prev => {
      if (k === 'del') { const n = prev.slice(0, -1); return n === '' ? '0' : n; }
      if (k === '.') { return prev.includes('.') ? prev : prev + '.'; }
      if (prev === '0') return k;
      if (prev.includes('.') && prev.split('.')[1].length >= 2) return prev;
      if (prev.replace('.', '').length >= 8) return prev;
      return prev + k;
    });
  }, [pendingIntent, busy]);

  const adjust = useCallback((d: number) => {
    if (pendingIntent || busy) return;
    setRaw(prev => {
      const next = Math.max(0, (Number(prev) || 0) + d);
      return String(Number(next.toFixed(2)));
    });
  }, [pendingIntent, busy]);

  const doLink = useCallback(async () => {
    if (operationRef.current) return;
    if (!code.trim()) { Alert.alert('Approval code needed', 'Approve Platinum Circles in IntoBank, then enter the connection code.'); return; }
    operationRef.current = true; setBusy(true);
    try {
      await paymentsService.linkAccount(code, ownerId);
      const balance = await paymentsService.getBalance();
      if (activeContextRef.current !== context) return;
      setLinked(!!balance?.linked); setWallet(balance?.linked ? balance : null); setCode('');
    } catch (e: any) {
      if (activeContextRef.current === context) Alert.alert('Could not connect', e?.message || 'Check your approval code and try again.');
    } finally { operationRef.current = false; setBusy(false); }
  }, [code, context, ownerId]);

  const checkPayment = useCallback(async () => {
    if (!pendingIntent || operationRef.current) return;
    operationRef.current = true; setBusy(true); setRetryAllowed(false);
    try {
      await showOutcome(pendingIntent, await paymentsService.getPaymentStatus(pendingIntent));
    } catch (e: any) {
      if (activeContextRef.current === context) setRecoveryMessage('Payment outcome unconfirmed. ' + (e?.message || 'Reconnect and check again.'));
    } finally { operationRef.current = false; setBusy(false); }
  }, [pendingIntent, showOutcome, context]);

  const doPay = useCallback(async () => {
    if (operationRef.current || loadError || amount <= 0) return;
    if (!peerHasBank && !pendingIntent) {
      Alert.alert('IntoBank connection needed', recipientName + ' needs to connect IntoBank before receiving this payment.');
      return;
    }
    operationRef.current = true; setBusy(true); setRetryAllowed(false);
    let intent: PaymentIntent | null = null;
    try {
      intent = await paymentsService.prepareIntent({
        ownerId, recipientId, amount, conversationId, currency: 'USD', listingId: listingId ?? null,
      });
      if (activeContextRef.current !== context) return;
      setPendingIntent(intent); setRaw(String(intent.amount));
      // Even an explicit retry first checks the authoritative server status.
      const status = await paymentsService.getPaymentStatus(intent);
      if (status.status !== 'not_found') { await showOutcome(intent, status); return; }
      if (activeContextRef.current !== context) return;
      const result = await paymentsService.sendMoney(intent);
      await showOutcome(intent, result);
    } catch (e: any) {
      if (activeContextRef.current === context) {
        if (!intent) setLoadError('Could not prepare this payment. ' + (e?.message || 'Close this sheet and try again.'));
        else setRecoveryMessage('Payment outcome unconfirmed. ' + (e?.message || 'Reconnect and check its status.'));
      }
    } finally { operationRef.current = false; setBusy(false); }
  }, [loadError, amount, peerHasBank, pendingIntent, recipientName, ownerId, recipientId, conversationId, listingId, context, showOutcome]);

  const doRequest = useCallback(() => {
    if (amount <= 0 || busy || pendingIntent || loadError) return;
    onRequested?.(amount, 'USD');
    onClose();
  }, [amount, busy, pendingIntent, loadError, onRequested, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={s.dismiss} activeOpacity={1} onPress={onClose} disabled={busy} />
        <View style={s.sheet}>
          <View style={s.handle} />

          {checking ? (
            <View style={s.center}><ActivityIndicator color={NAVY} /></View>
          ) : loadError && !pendingIntent ? (
            <View style={s.pad}>
              <Text style={s.linkTitle}>Payment details unavailable</Text>
              <Text style={s.linkSub}>{loadError}</Text>
              <TouchableOpacity style={s.cta} onPress={onClose}><Text style={s.ctaTxt}>Close</Text></TouchableOpacity>
            </View>
          ) : !linked && !pendingIntent ? (
            <View style={s.pad}>
              <View style={s.linkIcon}><Feather name="link" size={22} color={NAVY} /></View>
              <Text style={s.linkTitle}>Connect IntoBank</Text>
              <Text style={s.linkSub}>In IntoBank, open Profile, Connected apps, then Platinum Circles. Review the wallet access and payment permissions. Generate a connection code and paste it here.</Text>
              <TextInput
                style={s.field}
                value={code}
                onChangeText={setCode}
                placeholder="8-character approval code"
                placeholderTextColor="#B0B0B5"
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!busy}
                accessibilityLabel="IntoBank approval code"
              />
              <TouchableOpacity style={[s.cta, busy && s.off]} onPress={doLink} disabled={busy} activeOpacity={0.85}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.ctaTxt}>Connect approved account</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Text style={s.to}>To {recipientName}</Text>{peerHasBank ? <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E9F2EE', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, gap: 3 }}><Image source={require('../../assets/intobank-mark.png')} style={{ width: 16, height: 16, borderRadius: 4 }} /><Text style={{ fontSize: 10.5, fontWeight: '700', color: '#0A3D2E' }}>IntoBank</Text></View> : null}</View>
              {!!wallet && (
                <View style={s.fundRow}>
                  <Image source={require('../../assets/intobank-mark.png')} style={{ width: 14, height: 14, borderRadius: 4 }} />
                  <Text style={s.fundTxt} numberOfLines={1}>
                    {(wallet.email || 'IntoBank') + '  ·  ' + (wallet.currency || 'USD') + ' ' + Number(wallet.available ?? 0).toFixed(2) + ' available'}
                  </Text>
                </View>
              )}


              {!!recoveryMessage && <Text style={s.linkSub} accessibilityLiveRegion="polite">{recoveryMessage}</Text>}
              {!!loadError && <Text style={s.linkSub}>{loadError}</Text>}
              {pendingIntent && <Text style={s.fundTxt}>Reference: {pendingIntent.idempotencyKey}</Text>}
              <View style={s.amountRow}>
                <TouchableOpacity style={s.step} onPress={() => adjust(-1)} disabled={busy || !!pendingIntent} activeOpacity={0.7}>
                  <Feather name="minus" size={18} color="#3C3C43" />
                </TouchableOpacity>
                <View style={s.amountWrap}>
                  <Text style={[s.amount, { fontSize }]} numberOfLines={1} adjustsFontSizeToFit>
                    ${raw}
                  </Text>
                </View>
                <TouchableOpacity style={s.step} onPress={() => adjust(1)} disabled={busy || !!pendingIntent} activeOpacity={0.7}>
                  <Feather name="plus" size={18} color="#3C3C43" />
                </TouchableOpacity>
              </View>

              <View style={s.keypad}>
                {KEYS.map(k => (
                  <TouchableOpacity key={k} style={s.key} onPress={() => press(k)} disabled={busy || !!pendingIntent} activeOpacity={0.6}>
                    {k === 'del'
                      ? <Feather name="delete" size={22} color={NAVY} />
                      : <Text style={s.keyTxt}>{k}</Text>}
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.actions}>
                <TouchableOpacity
                  style={[s.request, (amount <= 0 || busy || !!pendingIntent || !!loadError) && s.off]}
                  onPress={doRequest}
                  disabled={amount <= 0 || busy || !!pendingIntent || !!loadError}
                  activeOpacity={0.85}
                >
                  <Text style={s.requestTxt}>Request</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.pay, (amount <= 0 || busy) && s.off]}
                  onPress={pendingIntent && !retryAllowed ? checkPayment : doPay}
                  disabled={busy || (!pendingIntent && (amount <= 0 || !!loadError || (!!wallet && (amount > Number(wallet.available ?? 0) || (wallet.per_tx_max != null && amount > Number(wallet.per_tx_max)))))) || (!!pendingIntent && retryAllowed && !!loadError)}
                  activeOpacity={0.85}
                >
                  {busy ? <ActivityIndicator color="#FFF" /> : (
                    <>
                      <Feather name="lock" size={14} color="#FFF" />
                      <Text style={s.payTxt}>{pendingIntent ? (retryAllowed ? 'Retry same payment' : 'Check status') : 'Pay'}</Text>
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

const s = themedSheet((t) => ({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: t.surface.canvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
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
  amount: { fontWeight: '800', color: NAVY, letterSpacing: -1.5 },
  step: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 8 },
  key: { flexBasis: '31%', flexGrow: 1, height: 54, borderRadius: 14, backgroundColor: '#F5F6F8', alignItems: 'center', justifyContent: 'center' },
  keyTxt: { fontSize: 24, fontWeight: '600', color: NAVY },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  request: { flex: 1, backgroundColor: t.surface.canvas, borderWidth: 1.5, borderColor: 'rgba(11,30,61,0.18)', borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  requestTxt: { color: NAVY, fontSize: 16, fontWeight: '700' },
  pay: { flex: 1, flexDirection: 'row', gap: 8, backgroundColor: NAVY, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  payTxt: { color: t.ink.inverse, fontSize: 16, fontWeight: '700' },
  off: { opacity: 0.4 },
  cta: { backgroundColor: NAVY, borderRadius: 16, paddingVertical: 16, marginTop: 16, alignItems: 'center' },
  ctaTxt: { color: t.ink.inverse, fontSize: 16, fontWeight: '700' },
}));
