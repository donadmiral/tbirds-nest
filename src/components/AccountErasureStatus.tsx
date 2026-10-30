import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { checkAccountErasure, loadAccountErasureReceipt } from '../services/accountErasureService';
import { erasureMessage, type ErasureReceipt, type ErasureStatus } from '../../shared/accountErasure';
import { useTheme } from '../theme/useTheme';

/** Available while signed out; receipt data stays in device secure storage. */
export default function AccountErasureStatus() {
  const { t: theme } = useTheme();
  const [receipt, setReceipt] = useState<ErasureReceipt | null>(null);
  const [status, setStatus] = useState<ErasureStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (saved: ErasureReceipt) => {
    setBusy(true); setError('');
    try {
      const next = await checkAccountErasure(saved); setStatus(next);
      if (!next) setError('This request is not confirmed, or its status receipt has expired. Contact support with the request number if you need help.');
    } catch { setError('Status is unavailable. Your saved request is still here; try again when connected.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    let alive = true;
    void loadAccountErasureReceipt().then(saved => { if (alive && saved) { setReceipt(saved); void refresh(saved); } }).catch(() => {});
    return () => { alive = false; };
  }, [refresh]);
  if (!receipt) return null;
  const copy = status ? erasureMessage(status) : { title: 'Account deletion status', detail: '' };
  return <View style={{ padding: 16, marginTop: 20, borderRadius: 16, borderWidth: 1, borderColor: theme.surface.hairline, backgroundColor: theme.surface.raised }}>
    <Text accessibilityRole="header" style={{ color: theme.ink.primary, fontWeight: '700', fontSize: 16 }}>{copy.title}</Text>
    {!!copy.detail && <Text style={{ color: theme.ink.secondary, marginTop: 8, lineHeight: 21 }}>{copy.detail}</Text>}
    {status && status.filesTotal > 0 && <Text style={{ color: theme.ink.secondary, marginTop: 8 }}>{status.filesErased} of {status.filesTotal} stored files erased</Text>}
    {!!error && <Text accessibilityLiveRegion="polite" style={{ color: theme.ink.secondary, marginTop: 8 }}>{error}</Text>}
    <Text selectable style={{ color: theme.ink.muted, marginTop: 8, fontSize: 11 }}>Request {receipt.requestId}</Text>
    <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void refresh(receipt)} style={{ minHeight: 44, justifyContent: 'center', marginTop: 8 }}>
      {busy ? <ActivityIndicator color={theme.ink.primary} /> : <Text style={{ color: theme.ink.primary, fontWeight: '600' }}>Refresh deletion status</Text>}
    </TouchableOpacity>
  </View>;
}
