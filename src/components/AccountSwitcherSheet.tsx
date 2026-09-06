/**
 * The account switcher, opened by a long-press on the Profile tab or from
 * Settings. Lists every account signed in on this phone, the current one
 * ticked; switching needs no sign-in.
 */
import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Image, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from './SafeArea';
import { Feather } from '@expo/vector-icons';
import { useAccountsStore, MAX_ACCOUNTS } from '../stores/accountsStore';
import { useTheme, themedSheet } from '../theme/useTheme';

export default function AccountSwitcherSheet() {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const open = useAccountsStore((s) => s.switcherOpen);
  const accounts = useAccountsStore((s) => s.accounts);
  const currentId = useAccountsStore((s) => s.currentId);
  const busy = useAccountsStore((s) => s.busy);
  const close = useAccountsStore((s) => s.closeSwitcher);
  const switchTo = useAccountsStore((s) => s.switchTo);
  const startAdd = useAccountsStore((s) => s.startAddAccount);
  const logOut = useAccountsStore((s) => s.logOutCurrent);
  const init = useAccountsStore((s) => s.init);

  useEffect(() => { if (open) init(); }, [open, init]);

  const current = accounts.find((a) => a.id === currentId);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <View style={st.wrap}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={close} />
        <View style={[st.sheet, { backgroundColor: t.surface.canvas, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={[st.handle, { backgroundColor: t.ink.faint }]} />
          <Text style={[st.title, { color: t.ink.primary }]}>Accounts</Text>
          {accounts.map((a) => {
            const isCurrent = a.id === currentId;
            return (
              <TouchableOpacity key={a.id} style={st.row} activeOpacity={0.75} disabled={busy}
                onPress={async () => { const err = await switchTo(a.id); if (err) Alert.alert('Could not switch', err); }}>
                {a.avatar_url ? <Image source={{ uri: a.avatar_url }} style={st.avatar} /> : <View style={[st.avatar, { backgroundColor: t.brand.tintBg, alignItems: 'center', justifyContent: 'center' }]}><Feather name="user" size={18} color={t.ink.muted} /></View>}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[st.name, { color: t.ink.primary }]} numberOfLines={1}>{a.full_name || a.username || 'Account'}</Text>
                  {a.username ? <Text style={[st.handleTxt, { color: t.ink.muted }]} numberOfLines={1}>@{a.username}</Text> : null}
                </View>
                {isCurrent ? <Feather name="check-circle" size={20} color={t.ink.primary} /> : null}
              </TouchableOpacity>
            );
          })}
          {accounts.length < MAX_ACCOUNTS ? (
            <TouchableOpacity style={st.row} activeOpacity={0.75} disabled={busy} onPress={startAdd}>
              <View style={[st.avatar, { borderWidth: 1.5, borderColor: t.ink.faint, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }]}><Feather name="plus" size={18} color={t.ink.primary} /></View>
              <Text style={[st.name, { color: t.ink.primary, flex: 1 }]}>Add account</Text>
            </TouchableOpacity>
          ) : null}
          {current ? (
            <TouchableOpacity style={[st.row, { marginTop: 4 }]} activeOpacity={0.75} disabled={busy}
              onPress={() => Alert.alert('Log out?', 'Log out of ' + (current.username ? '@' + current.username : 'this account') + ' on this phone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: () => logOut() }])}>
              <View style={[st.avatar, { alignItems: 'center', justifyContent: 'center' }]}><Feather name="log-out" size={18} color={t.status.danger} /></View>
              <Text style={[st.name, { color: t.status.danger, flex: 1 }]}>Log out of {current.username ? '@' + current.username : 'this account'}</Text>
            </TouchableOpacity>
          ) : null}
          {busy ? <View style={st.busy}><ActivityIndicator color={t.ink.primary} /></View> : null}
        </View>
      </View>
    </Modal>
  );
}

const st = themedSheet((t) => ({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  name: { fontSize: 15, fontWeight: '700' },
  handleTxt: { fontSize: 12.5, marginTop: 1 },
  busy: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.5)' },
}));