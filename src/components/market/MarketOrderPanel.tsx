import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import 'react-native-get-random-values';
import { createOrderRequest, orderTimeout, orderRejected } from '../../../shared/orderRequest';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import { useTheme, themedSheet } from '../../theme/useTheme';
import SendMoneySheet from '../SendMoneySheet';
import { orderActions, orderError, orderMoney, orderStatus, type MarketOrder, type OrderCursor, type OrderListing, type OrderPage, type OrderAction } from '../../../shared/marketOrders';

function requestId() {
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
}
export default function MarketOrderPanel({ listing, onMessage }: { listing?: OrderListing; onMessage?: (order: MarketOrder) => void }) {
  useTheme(); const uid = useAuthStore(s => s.session?.user.id || '');
  const [rows, setRows] = useState<MarketOrder[]>([]); const [cursor, setCursor] = useState<OrderCursor | null>(null); const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [quantity, setQuantity] = useState('1'); const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup'); const [instructions, setInstructions] = useState('');
  const [payment, setPayment] = useState<MarketOrder | null>(null); const [noteAction, setNoteAction] = useState<{ order: MarketOrder; action: OrderAction } | null>(null); const [note, setNote] = useState('');
  const reading = useRef(false); const generation = useRef(0); const lock = useRef(false); const request = useRef(createOrderRequest<{p_expected_user:string;p_listing_id:string|undefined;p_quantity:number;p_fulfilment:string;p_instructions:string}>()); const scope = useRef(0); const [pendingRequest,setPendingRequest]=useState(false); const current = useRef(uid); current.current = uid;
  const listingId = listing?.id;
  const load = useCallback(async (next?: OrderCursor | null) => {
    if(reading.current)return;reading.current=true;
    const run = ++generation.current; if (!uid) { reading.current=false;setLoading(false); return; } setLoading(true);
    try {
      const { data, error: err } = await orderTimeout(supabase.rpc('get_market_orders', { p_listing_id: listingId || null, p_before: next?.created_at || null, p_before_id: next?.id || null, p_limit: 20 }));
      if (err) throw err; if (run !== generation.current || current.current !== uid) return;
      const page = data as OrderPage; setRows(old => next ? [...old, ...page.rows.filter(r => !old.some(x => x.id === r.id))] : page.rows); setMore(page.has_more); setCursor(page.next_cursor); setError('');
    } catch (e) { if (run === generation.current && current.current === uid) setError(orderError(e)); }
    finally { if (run === generation.current && current.current === uid) {reading.current=false;setLoading(false);} }
  }, [uid, listingId]);
  useEffect(() => {
    current.current = uid; scope.current++; lock.current = false;reading.current=false; request.current.clear(); setPendingRequest(false); setBusy(false); setRows([]); setCursor(null); setMore(false); setError('');
    setPayment(null); setNoteAction(null); setNote(''); setQuantity('1'); setFulfilment('pickup'); setInstructions(''); void load();
    return () => { scope.current++; generation.current++; current.current = ''; };
  }, [load, uid]);
  const mutate = async (order?: MarketOrder, action?: string, detail = '') => {
    if (!uid || lock.current || current.current !== uid) return; const actor = uid, epoch = scope.current; lock.current = true; setBusy(true); setError('');
    try {
      if (useAuthStore.getState().session?.user.id !== actor) throw new Error('ACCOUNT_CHANGED');
      const args = order ? null : request.current.get({p_expected_user: actor, p_listing_id: listingId, p_quantity: Number(quantity), p_fulfilment: fulfilment, p_instructions: instructions}, requestId);
      if (args) setPendingRequest(true);
      const { error: err } = order ? await orderTimeout(supabase.rpc('market_order_action', { p_expected_user: actor, p_id: order.id, p_version: order.version, p_action: action, p_note: detail }))
        : await orderTimeout(supabase.rpc('create_market_order', args!));
      if (err) throw err; if (scope.current !== epoch) return;
      if (!order) {request.current.clear();setPendingRequest(false);} setNoteAction(null); await load();
    } catch (e) { if (scope.current === epoch) { if (!order && orderRejected(e)) {request.current.clear();setPendingRequest(false);} setError(orderError(e)); } }
    finally { if (scope.current === epoch) {lock.current = false;setBusy(false);} }
  };
  const history = async (order: MarketOrder) => {
    if (lock.current || !uid) return; const epoch=scope.current, run=generation.current;lock.current=true;setBusy(true);
    try { const {data,error:err}=await orderTimeout(supabase.rpc('get_market_order',{p_id:order.id})); if(err)throw err;
      if(epoch===scope.current&&run===generation.current)setRows(old=>old.map(o=>o.id===order.id?data as MarketOrder:o));
    } catch(e){if(epoch===scope.current)setError(orderError(e));}
    finally{if(epoch===scope.current){lock.current=false;setBusy(false);}}
  };
  const chooseAction = (order: MarketOrder, action: OrderAction) => {
    if (action.note) { setNote(''); setNoteAction({ order, action }); return; }
    if (['complete', 'returned'].includes(action.id)) { Alert.alert(action.label, 'Only confirm after receiving the item.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: () => void mutate(order, action.id) }]); return; }
    void mutate(order, action.id);
  };
  const button = (label: string, fn: () => void, disabled = false) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={busy || loading || disabled} onPress={fn} style={[s.button, (busy || loading || disabled) && { opacity: 0.5 }]}><Text style={s.buttonText}>{label}</Text></TouchableOpacity>;
  return <View style={s.container}>
    <View style={s.row}><Text style={s.title}>Orders</Text>{button('Refresh orders', () => void load())}</View>
    {!!uid && listing && listing.seller_id !== uid && (pendingRequest || (listing.status === 'available' && (listing.stock_quantity ?? 1) > 0)) && <View style={s.card}>
      <Text style={s.text}>Request an order at the listing price. The seller confirms stock before you pay.</Text>
      <Text style={s.label}>Quantity</Text><TextInput accessibilityLabel="Order quantity" keyboardType="number-pad" value={quantity} maxLength={3} editable={!busy && !pendingRequest} onChangeText={v => { setQuantity(v); }} style={s.input} />
      {listing.delivery_available && <View style={s.row}>{button(fulfilment === 'pickup' ? '✓ Pickup' : 'Pickup', () => { setFulfilment('pickup'); },pendingRequest)}{button(fulfilment === 'delivery' ? '✓ Delivery' : 'Delivery', () => { setFulfilment('delivery'); },pendingRequest)}</View>}
      <Text style={s.label}>{fulfilment === 'delivery' ? 'Delivery instructions, shared with the seller' : 'Pickup notes (optional)'}</Text>
      <TextInput accessibilityLabel="Order instructions" value={instructions} onChangeText={v => { setInstructions(v); }} maxLength={1000} multiline editable={!busy && !pendingRequest} style={s.input} />
      {button(pendingRequest?'Retry same order request':'Request order', () => void mutate(), !pendingRequest && (!Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > Math.min(100,listing.stock_quantity??100) || (fulfilment === 'delivery' && instructions.trim().length < 5)))}
      <Text style={s.small}>Requesting an order does not charge you. Delivery is arranged directly with the seller.</Text>
    </View>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{loading && <ActivityIndicator />}
    {!loading && !error && !rows.length && <Text style={s.small}>{uid ? 'No orders yet.' : 'Sign in to manage orders.'}</Text>}
    {rows.map(order => <View style={s.card} key={order.id}>
      <Text style={s.label}>{order.title} × {order.quantity}</Text><Text style={s.title}>{orderMoney(order.total_minor, order.currency)}</Text>
      <Text style={s.text}>{orderStatus[order.status]} · {order.fulfilment === 'pickup' ? 'Pickup' : 'Seller-arranged delivery'}</Text>
      <Text style={s.small}>Order {order.id.slice(0, 8)} · {new Date(order.created_at).toLocaleString()}</Text>
      {!!order.instructions && <Text style={s.text}>{order.instructions}</Text>}
      {order.status === 'awaiting_payment' && order.expires_at && <Text style={s.small}>{order.payment_id ? 'A payment is being checked. Check its status before trying again.' : 'Reservation expires ' + new Date(order.expires_at).toLocaleString()}</Text>}
      {['returned', 'return_requested', 'return_approved', 'disputed'].includes(order.status) && <Text style={s.small}>Refunds are only complete when IntoBank confirms them. Keep your payment and delivery evidence.</Text>}
      <View style={s.row}>
        {order.buyer_id === uid && order.status === 'awaiting_payment' && !!order.conversation_id && button(order.payment_id ? 'Check IntoBank payment' : 'Review and pay', () => setPayment(order), order.currency !== 'USD' || (!order.payment_id && !!order.expires_at && new Date(order.expires_at).getTime() < Date.now()))}
        {!!order.conversation_id && onMessage && button('Message', () => onMessage(order))}
        {orderActions(order, uid).map(action => <React.Fragment key={action.id}>{button(action.label, () => chooseAction(order, action))}</React.Fragment>)}
        {button('History', () => void history(order))}
      </View>
      {order.status === 'awaiting_payment' && order.currency !== 'USD' && <Text style={s.small}>IntoBank Chat Pay currently supports USD orders.</Text>}
      {order.events?.map(event => <Text key={event.id} style={s.small}>{new Date(event.created_at).toLocaleString()} · {event.kind.replace(/_/g, ' ')}{event.note ? ': ' + event.note : ''}</Text>)}
    </View>)}
    {more && button('Load more orders', () => void load(cursor))}
    {!!payment?.conversation_id && <SendMoneySheet visible onClose={() => { setPayment(null); void load(); }} recipientId={payment.seller_id} recipientName="Seller" conversationId={payment.conversation_id} listingId={payment.listing_id} orderId={payment.id} initialAmount={Number(payment.total_minor) / 100} onSent={() => void load()} />}
    <Modal visible={!!noteAction} transparent animationType="slide" onRequestClose={() => { if (!busy) setNoteAction(null); }}><View style={s.overlay}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modal}>
      <Text style={s.title}>{noteAction?.action.note}</Text><TextInput autoFocus multiline maxLength={1000} value={note} onChangeText={setNote} style={s.input} accessibilityLabel="Order action details" />
      {button('Save', () => { if (noteAction) void mutate(noteAction.order, noteAction.action.id, note); }, note.trim().length < 5)}{button('Cancel', () => setNoteAction(null))}
    </ScrollView></View></Modal>
  </View>;
}
const s = themedSheet(t => ({
  container: { padding: 16, gap: 12 }, title: { fontSize: 18, fontWeight: '700', color: t.ink.primary }, label: { fontSize: 14, fontWeight: '600', color: t.ink.primary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, card: { padding: 14, borderRadius: 14, backgroundColor: t.surface.raised, gap: 10 },
  text: { fontSize: 14, color: t.ink.primary, lineHeight: 21 }, small: { fontSize: 12, color: t.ink.secondary, lineHeight: 18 }, error: { fontSize: 14, color: t.status.danger },
  button: { minHeight: 44, justifyContent: 'center', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: t.surface.canvas }, buttonText: { fontSize: 13, fontWeight: '600', color: t.ink.primary },
  input: { minHeight: 44, padding: 12, borderRadius: 10, color: t.ink.primary, backgroundColor: t.surface.canvas }, overlay: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,.5)' }, modal: { padding: 20, borderRadius: 16, gap: 12, backgroundColor: t.surface.raised },
}));
