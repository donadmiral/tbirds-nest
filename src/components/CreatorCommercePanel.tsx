import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import 'react-native-get-random-values';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { themedSheet, useTheme } from '../theme/useTheme';
import { readCreatorCommerce, saveCreatorProduct, type CreatorCommerce, type CreatorProduct } from '../../shared/monetization/commerce';
import { formatMinor, usdToMinor } from '../../shared/monetization/domain';
import { REVENUE_SHARES, REVENUE_LABELS, REVENUE_POLICY_VERSION } from '../../shared/monetization/policy';
function newId() { const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = Array.from(b, n => n.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }
export default function CreatorCommercePanel({ owner, approved }: { owner: string; approved: boolean }) {
  const { t } = useTheme();
  const [data, setData] = useState<CreatorCommerce | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [showRates, setShowRates] = useState(false);
  const [title, setTitle] = useState(''), [price, setPrice] = useState(''), [days, setDays] = useState('30');
  const [kind, setKind] = useState<CreatorProduct['kind']>('subscription');
  const live = useRef(false), generation = useRef(0), lock = useRef(false), draftId = useRef<string | null>(null);
  async function load() {
    const run = ++generation.current; setLoading(true); setError('');
    try { const next = await readCreatorCommerce(supabase, owner); if (live.current && generation.current === run) setData(next); }
    catch (e) { if (live.current && generation.current === run) { setData(null); setError(e instanceof Error ? e.message : 'Could not load creator products.'); } }
    finally { if (live.current && generation.current === run) setLoading(false); }
  }
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; generation.current++; }; }, [owner]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(existing?: CreatorProduct) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      if (useAuthStore.getState().session?.user.id !== owner) throw new Error('Your account changed. Reopen monetization.');
      const product = existing || { id: draftId.current ||= newId(), title, amount_minor: usdToMinor(price), kind, active: false, period_days: kind === 'subscription' ? Number(days) : null };
      await saveCreatorProduct(supabase, owner, product);
      if (!live.current) return;
      if (!existing) { draftId.current = null; setTitle(''); setPrice(''); }
      await load();
    } catch (e) { if (live.current) setError(e instanceof Error ? e.message : 'Could not save this product.'); }
    finally { if (live.current) { lock.current = false; setBusy(false); } }
  }
  return <View style={s.card}>
    <View style={s.row}><Text style={s.heading}>Products and purchases</Text><TouchableOpacity accessibilityRole="button" disabled={loading || busy} style={s.touch} onPress={() => void load()}><Text style={s.link}>Refresh</Text></TouchableOpacity></View>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    {loading && !data ? <ActivityIndicator color={t.ink.primary} accessibilityLabel="Loading creator products" /> : null}
    {data && <>
      <Text style={s.note}>{data.capabilities.purchases_enabled ? 'Sandbox purchases are enabled. These do not transfer real money.' : 'Purchases are not open yet. Prepare your products below; saving a product does not charge anyone.'} Subscriptions provide prepaid access. Automatic renewal is not enabled.</Text>
      {data.refund_balance_minor !== '0' && <Text style={s.body}>Refund balance: {formatMinor(data.refund_balance_minor, 'USD')}. Future earnings cover this balance before another payout.</Text>}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showRates }} style={s.touch} onPress={() => setShowRates(v => !v)}><Text style={s.link}>Program revenue shares</Text></TouchableOpacity>
      {showRates && <View style={s.group}>{Object.entries(REVENUE_SHARES).map(([key, bps]) => <Text key={key} style={s.body}>{REVENUE_LABELS[key as keyof typeof REVENUE_LABELS]}: {bps / 100}% to creator</Text>)}<Text style={s.note}>Policy {REVENUE_POLICY_VERSION}. Shares use eligible net revenue after disclosed deductions. Genuine tips go fully to the recipient with no Platinum commission or attached benefit. No rate guarantees earnings.</Text></View>}
      {approved && <View style={s.group}>
        <Text style={s.heading}>Prepare a product</Text>
        <View style={s.row}>{(['subscription', 'tip', 'gift'] as const).map(value => <TouchableOpacity key={value} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: kind === value }} style={s.touch} onPress={() => setKind(value)}><Text style={[s.body, kind === value && s.selected]}>{value === 'subscription' ? 'Subscription' : value === 'tip' ? 'Tip' : 'Gift'}</Text></TouchableOpacity>)}</View>
        <TextInput style={s.input} accessibilityLabel="Product name" placeholder="Product name" placeholderTextColor={t.ink.muted} maxLength={120} editable={!busy} value={title} onChangeText={setTitle} />
        <TextInput style={s.input} accessibilityLabel="Price in USD" placeholder="Price in USD" placeholderTextColor={t.ink.muted} keyboardType="decimal-pad" editable={!busy} value={price} onChangeText={setPrice} />
        {kind === 'subscription' && <><Text style={s.note}>Prepaid access period in days (1–366)</Text><TextInput style={s.input} accessibilityLabel="Access period in days" keyboardType="number-pad" editable={!busy} value={days} onChangeText={setDays} /></>}
        <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.button} onPress={() => void save()}><Text style={s.buttonText}>{busy ? 'Saving…' : 'Save draft product'}</Text></TouchableOpacity>
      </View>}
      {data.products.map(product => <View key={product.id} style={s.group}><Text style={s.body}>{product.title} · {formatMinor(product.amount_minor, 'USD')}{product.period_days ? ` / ${product.period_days} days` : ''}</Text><Text style={s.note}>{product.active ? 'Listed' : 'Draft'}</Text>{approved && <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.touch} onPress={() => void save({ ...product, active: !product.active })}><Text style={s.link}>{product.active ? 'Unlist' : 'List product'}</Text></TouchableOpacity>}</View>)}
      {data.purchases.length > 0 && <Text style={s.heading}>Recent purchases</Text>}
      {data.purchases.map(p => <View key={p.id} style={s.group}><Text style={s.body}>{p.title} · {formatMinor(p.amount_minor, 'USD')}</Text><Text style={s.note}>{p.state.replace(/_/g, ' ')} · {new Date(p.created_at).toLocaleString()}{p.refunded_minor !== '0' ? ` · Refunded ${formatMinor(p.refunded_minor, 'USD')}` : ''}</Text></View>)}
      {data.subscriptions.length > 0 && <Text style={s.heading}>Paid access periods</Text>}
      {data.subscriptions.map(p => <Text key={p.creator_id + p.starts_at} style={s.note}>{new Date(p.starts_at).toLocaleDateString()}–{new Date(p.ends_at).toLocaleDateString()} · No automatic renewal</Text>)}
    </>}
  </View>;
}
const s = themedSheet(t => ({
  card: { padding: 18, gap: 10, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 16, backgroundColor: t.surface.raised },
  heading: { fontSize: 17, fontWeight: '800', color: t.ink.primary }, body: { fontSize: 14, lineHeight: 21, color: t.ink.primary }, note: { fontSize: 13, lineHeight: 20, color: t.ink.muted },
  group: { gap: 8, paddingVertical: 8 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  touch: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }, link: { color: t.ink.primary, textDecorationLine: 'underline' }, selected: { fontWeight: '800', textDecorationLine: 'underline' },
  input: { minHeight: 48, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 10, padding: 12, color: t.ink.primary },
  button: { minHeight: 48, padding: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: t.brand.base }, buttonText: { color: t.ink.inverse, fontWeight: '700' }, error: { color: t.status.danger, fontSize: 14 },
}));
