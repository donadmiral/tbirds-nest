import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { decimalMinor } from '../../../shared/commerceMoney';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { themedSheet, useTheme } from '../../theme/useTheme';

export type CounterOffer = {
  id: string;
  status: string;
  buyer_id: string;
  seller_id: string;
  proposer_id: string;
  amount: number | string;
  currency: string;
};
type Phase = 'loading' | 'input' | 'review' | 'sending' | 'unknown' | 'resolved' | 'error';
type Props = {
  offerId: string;
  ownerId: string;
  actorId: string;
  onClose: () => void;
  onResolved: (offer: CounterOffer) => void;
};
const unavailable = 'Counter-offers are not available in this app environment yet. Please try again later.';
function amountValue(raw: string): string {
  const value = raw.trim();
  const minor = decimalMinor(value);
  if (minor <= BigInt(0) || minor > BigInt('999999999999')) throw new Error('Enter an amount from 0.01 to 9,999,999,999.99, with up to two decimal places.');
  return `${minor / BigInt(100)}.${String(minor % BigInt(100)).padStart(2, '0')}`;
}
function sameOffer(a: CounterOffer, b: CounterOffer) {
  return a.id === b.id && a.status === b.status && a.proposer_id === b.proposer_id
    && a.buyer_id === b.buyer_id && a.seller_id === b.seller_id && a.currency === b.currency
    && String(a.amount) === String(b.amount);
}

/** A keyed dialog gives Android and iOS the same input, review and cancel flow. */
export function CounterOfferDialog({ offerId, ownerId, actorId, onClose, onResolved }: Props) {
  const { t } = useTheme();
  const activeOwner = useAuthStore(state => state.session?.user.id ?? null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [offer, setOffer] = useState<CounterOffer | null>(null);
  const [amount, setAmount] = useState('');
  const [reviewAmount, setReviewAmount] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const current = useCallback((request: number) => mounted.current && request === generation.current
    && useAuthStore.getState().session?.user.id === ownerId, [ownerId]);

  const loadOffer = useCallback(async () => {
    if (useAuthStore.getState().session?.user.id !== ownerId) throw new Error('The signed-in account changed. Reopen this offer.');
    const { data, error: readError } = await supabase.from('listing_offers')
      .select('id,status,buyer_id,seller_id,proposer_id,amount,currency').eq('id', offerId).maybeSingle();
    if (readError) throw new Error('The offer could not be checked. Please try again.');
    if (!data || data.id !== offerId || ownerId !== actorId
      || (data.buyer_id !== actorId && data.seller_id !== actorId)
      || data.proposer_id === actorId) throw new Error('Only the other participant can respond to this offer.');
    if (data.currency !== 'USD' && data.currency !== 'ZWG') throw new Error('This offer uses an unsupported currency.');
    // Reject corrupt or unsupported values before presenting a monetary review.
    amountValue(String(data.amount));
    return data as CounterOffer;
  }, [actorId, offerId, ownerId]);

  const load = useCallback(async () => {
    const request = generation.current;
    if (pending.current || !current(request)) return;
    pending.current = true; setPhase('loading'); setError('');
    try {
      const { data: capability, error: capabilityError } = await supabase.rpc('offer_response_capabilities');
      if (!current(request)) return;
      if (capabilityError || capability?.version !== 1 || capability.serialized !== true
        || capability.fractionDigits !== 2 || capability.maxAmount !== '9999999999.99') throw new Error(unavailable);
      const row = await loadOffer();
      if (!current(request)) return;
      setOffer(row); setPhase(row.status === 'pending' ? 'input' : 'resolved');
    } catch (failure) {
      if (current(request)) { setError(failure instanceof Error ? failure.message : 'The offer could not be loaded. Please try again.'); setPhase('error'); }
    } finally { if (current(request)) pending.current = false; }
  }, [current, loadOffer]);

  useEffect(() => {
    const request = ++generation.current;
    mounted.current = true; pending.current = false;
    void load();
    return () => { mounted.current = false; generation.current = request + 1; pending.current = false; };
  }, [load]);

  const review = () => {
    if (phase !== 'input' || !offer || !current(generation.current)) return;
    try { setReviewAmount(amountValue(amount)); setError(''); setPhase('review'); }
    catch { setError('Enter an amount from 0.01 to 9,999,999,999.99, with up to two decimal places.'); }
  };
  const submit = async () => {
    if (pending.current || phase !== 'review' || !offer || !current(generation.current)) return;
    const request = generation.current;
    pending.current = true; setError(''); setPhase('sending');
    let sent = false;
    try {
      const row = await loadOffer();
      if (!current(request)) return;
      if (!sameOffer(offer, row)) {
        setOffer(row); setPhase(row.status === 'pending' ? 'input' : 'resolved');
        setError('This offer changed. Check the current details before responding.');
        return;
      }
      sent = true;
      // Keep the existing provider contract. The repaired endpoint serializes
      // responses; no unsupported version/idempotency parameter or auto-retry.
      const { error: responseError } = await supabase.rpc('respond_offer', {
        p_offer_id: offerId, p_action: 'countered', p_counter_amount: reviewAmount,
      });
      if (!current(request)) return;
      if (responseError) throw responseError;
      onResolved({ ...row, status: 'countered' });
    } catch {
      if (!current(request)) return;
      setPhase(sent ? 'unknown' : 'review');
      setError(sent
        ? 'The response was not confirmed. Check the current offer status before trying again.'
        : 'The offer could not be checked. Your counter-offer has not been sent.');
    } finally { if (current(request)) pending.current = false; }
  };
  const checkStatus = async () => {
    if (pending.current || !current(generation.current)) return;
    const request = generation.current;
    pending.current = true;
    try {
      const row = await loadOffer();
      if (!current(request)) return;
      setOffer(row);
      if (row.status !== 'pending') { setError(''); setPhase('resolved'); }
      else {
        setPhase('input');
        setError('The offer is still pending. Review your amount again if you want to send a new response.');
      }
    } catch { if (current(request)) setError('The current offer status could not be checked. Keep this offer and check again when connected.'); }
    finally { if (current(request)) pending.current = false; }
  };

  if (activeOwner !== ownerId) return null;
  const busy = phase === 'loading' || phase === 'sending';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.card} accessibilityViewIsModal>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
            <Text accessibilityRole="header" style={s.title}>{phase === 'review' ? 'Review counter-offer' : 'Counter-offer'}</Text>
            {offer && <View style={s.summary}>
              <Text style={s.label}>Current offer</Text>
              <Text style={s.money}>{offer.currency} {Number(offer.amount).toFixed(2)}</Text>
              <Text style={s.help}>Status: {offer.status}</Text>
            </View>}
            {phase === 'input' && <View>
              <Text style={s.label}>Your counter-offer ({offer?.currency})</Text>
              <TextInput accessibilityLabel="Counter-offer amount" style={s.input} value={amount}
                onChangeText={value => { setAmount(value); setError(''); }} keyboardType="decimal-pad"
                autoFocus placeholder="0.00" placeholderTextColor={t.ink.muted} maxLength={16}
                returnKeyType="done" onSubmitEditing={review} />
              <Text style={s.help}>Use a decimal point for cents. Review the amount before sending.</Text>
            </View>}
            {(phase === 'review' || phase === 'sending' || phase === 'unknown') && <View style={s.summary}>
              <Text style={s.label}>Your counter-offer</Text>
              <Text style={s.money}>{offer?.currency} {reviewAmount}</Text>
              <Text style={s.help}>The other participant will receive a new offer. No payment is made here.</Text>
            </View>}
            {phase === 'resolved' && <Text style={s.help}>This offer has already been {offer?.status}. Return to the conversation for the latest offer.</Text>}
            {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
            {busy && <View style={s.progress}><ActivityIndicator color={t.brand.base} /><Text style={s.help}>{phase === 'sending' ? 'Sending counter-offer…' : 'Checking offer…'}</Text></View>}
            {phase === 'sending' && <Text style={s.help}>Closing this dialog does not cancel a response already sent.</Text>}
            <View style={s.actions}>
              <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={onClose}>
                <Text style={s.secondaryText}>{phase === 'sending' || phase === 'unknown' || phase === 'resolved' ? 'Close' : 'Cancel'}</Text>
              </TouchableOpacity>
              {phase === 'input' && <TouchableOpacity accessibilityRole="button" style={s.primary} onPress={review}><Text style={s.primaryText}>Review counter-offer</Text></TouchableOpacity>}
              {phase === 'review' && <TouchableOpacity accessibilityRole="button" style={s.secondary} onPress={() => { if (!pending.current) setPhase('input'); }}><Text style={s.secondaryText}>Edit amount</Text></TouchableOpacity>}
              {phase === 'review' && <TouchableOpacity accessibilityRole="button" style={s.primary} onPress={submit}><Text style={s.primaryText}>Send counter-offer</Text></TouchableOpacity>}
              {phase === 'unknown' && <TouchableOpacity accessibilityRole="button" style={s.primary} onPress={checkStatus}><Text style={s.primaryText}>Check status</Text></TouchableOpacity>}
              {phase === 'error' && <TouchableOpacity accessibilityRole="button" style={s.primary} onPress={load}><Text style={s.primaryText}>Try again</Text></TouchableOpacity>}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = themedSheet(t => ({
  backdrop: { flex: 1, backgroundColor: t.surface.scrim, padding: 20, justifyContent: 'center', alignItems: 'center' },
  card: { width: '100%', maxWidth: 480, maxHeight: '90%', borderRadius: 24, backgroundColor: t.surface.raised, borderWidth: 1, borderColor: t.surface.hairline },
  content: { padding: 24, gap: 18 }, title: { fontSize: 24, fontWeight: '800', color: t.ink.primary },
  summary: { gap: 6, padding: 16, borderRadius: 14, backgroundColor: t.surface.sunken },
  label: { fontSize: 14, fontWeight: '700', color: t.ink.primary }, money: { fontSize: 26, fontWeight: '800', color: t.ink.primary },
  help: { fontSize: 14, lineHeight: 21, color: t.ink.secondary }, error: { fontSize: 14, lineHeight: 21, color: t.ink.primary },
  input: { minHeight: 52, marginVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 12, color: t.ink.primary, fontSize: 22, backgroundColor: t.surface.canvas },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 12 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  secondary: { minHeight: 46, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 12, justifyContent: 'center' },
  secondaryText: { color: t.ink.primary, fontSize: 14, fontWeight: '700' },
  primary: { minHeight: 46, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: t.brand.base, justifyContent: 'center' },
  primaryText: { color: t.ink.inverse, fontSize: 14, fontWeight: '700' },
}));
