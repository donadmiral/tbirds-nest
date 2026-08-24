/**
 * BusinessManageScreen
 *
 * One business, its details and its team, in one screen.
 *
 * Hours are jsonb, {"mon":[["08:00","17:00"]]}, so a closed day or a split shift
 * costs no extra columns. Times are sanitised as they are typed and validated
 * before saving, because a free text time field will eventually contain a word.
 *
 * Role permissions are enforced on the server. They are mirrored here so a
 * manager never sees an action that would come back as an error.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Switch, KeyboardAvoidingView, Platform, StatusBar, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { useActorStore } from '../../stores/actorStore';
import { light, typeSize, fontWeight, radius, space } from '../../constants/tokens';

const CATEGORIES = [
  'Retail', 'Food & Drink', 'Technology', 'Services', 'Health & Beauty',
  'Education', 'Transport', 'Construction', 'Agriculture', 'Finance',
  'Entertainment', 'Fashion', 'Property', 'Other',
];

const DAYS = [
  { key: 'mon', label: 'Monday' }, { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' }, { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' }, { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

type Member = {
  member_id: string; full_name: string | null; username: string | null;
  avatar_url: string | null; role: string; joined_at: string | null;
};

type Hours = Record<string, string[][]>;

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

/** Digits only, colon inserted, hours and minutes clamped to something real. */
function sanitiseTime(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 4);
  if (d.length === 0) return '';
  if (d.length <= 2) return d;
  let h = Math.min(23, parseInt(d.slice(0, 2), 10));
  let m = Math.min(59, parseInt(d.slice(2).padEnd(2, '0'), 10));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isValidTime(t: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(t ?? '');
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

export default function BusinessManageScreen({ route, navigation }: any) {
  const businessId: string = route?.params?.businessId;
  const [inboxUnread, setInboxUnread] = useState(0);
  const [awayOn, setAwayOn] = useState(false);
  const [awayMsg, setAwayMsg] = useState('');
  useEffect(() => {
    if (!businessId) return;
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.from('business_dm_settings')
          .select('away_enabled, away_message').eq('business_id', businessId).maybeSingle();
        if (live && data) { setAwayOn(!!data.away_enabled); setAwayMsg(data.away_message || ''); }
      } catch {}
    })();
    return () => { live = false; };
  }, [businessId]);
  const saveAway = useCallback(async (on: boolean, msg: string) => {
    try {
      await supabase.from('business_dm_settings').upsert({ business_id: businessId, away_enabled: on, away_message: msg, updated_at: new Date().toISOString() });
    } catch {}
  }, [businessId]);
  useEffect(() => {
    if (!businessId) return;
    let live = true;
    const tick = async () => {
      try {
        const { data } = await supabase.rpc('get_business_unread', { p_business_id: businessId });
        if (live) setInboxUnread(typeof data === 'number' ? data : 0);
      } catch {}
    };
    tick();
    const iv = setInterval(tick, 25000);
    return () => { live = false; clearInterval(iv); };
  }, [businessId]);
  const insets = useSafeAreaInsets();
  const { profile: authProfile } = useAuthStore();
  const myId = (authProfile as any)?.id ?? null;

  const [profile, setProfile] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [category, setCategory] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState('');
  const [hours, setHours] = useState<Hours>({});

  const [newMember, setNewMember] = useState('');
  const [adding, setAdding] = useState(false);

  // Resolved from the real member list, not from a field get_profile does not return.
  const myRole = useMemo(
    () => members.find(m => m.member_id === myId)?.role ?? null,
    [members, myId],
  );
  const isOwner = myRole === 'owner';

  const load = useCallback(async () => {
    if (!businessId) { setError('No business selected'); setLoading(false); return; }
    setError(null);

    const [{ data: pj, error: pErr }, { data: mem, error: mErr }] = await Promise.all([
      supabase.rpc('get_profile', { p_profile_id: businessId }),
      supabase.rpc('get_business_members', { p_business_id: businessId }),
    ]);

    if (pErr) { setError(pErr.message); setLoading(false); return; }
    if (mErr) { setError(mErr.message); setLoading(false); return; }

    const p: any = pj || {};
    const b = p.business || {};
    setProfile(p);
    setMembers((mem ?? []) as Member[]);
    setCategory(b.category || '');
    setPhone(b.phone || '');
    setEmail(b.email || '');
    setWebsite(b.website || '');
    setAddress(b.address || '');
    setLocation(p.location || '');
    setHours((b.hours as Hours) || {});
    setLoading(false);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const saveInfo = async () => {
    const bad = DAYS.filter(d => {
      const r = hours[d.key]?.[0];
      return r && (!isValidTime(r[0]) || !isValidTime(r[1]));
    });
    if (bad.length) {
      Alert.alert('Check your hours', `${bad.map(d => d.label).join(', ')} needs a time like 08:00.`);
      return;
    }

    setSaving(true);
    const { error: err } = await supabase.rpc('update_business_info', {
      p_business_id: businessId,
      p_category: category || null,
      p_phone: phone || null,
      p_email: email || null,
      p_website: website || null,
      p_address: address || null,
      p_location: location || null,
      p_hours: Object.keys(hours).length ? hours : null,
      p_social: null,
    });
    setSaving(false);
    if (err) { Alert.alert('Could not save', err.message); return; }
    Alert.alert('Saved', 'Business details updated.');
  };

  const setDayOpen = (day: string, open: boolean) => {
    setHours(h => ({ ...h, [day]: open ? (h[day]?.length ? h[day] : [['08:00', '17:00']]) : [] }));
  };
  const setDayTime = (day: string, idx: 0 | 1, value: string) => {
    setHours(h => {
      const range = h[day]?.[0] ?? ['08:00', '17:00'];
      const next = [...range];
      next[idx] = sanitiseTime(value);
      return { ...h, [day]: [next] };
    });
  };

  const addMember = async () => {
    const u = newMember.trim().toLowerCase();
    if (!u) return;
    setAdding(true);
    const { error: err } = await supabase.rpc('add_business_member', {
      p_business_id: businessId, p_username: u, p_role: 'contributor',
    });
    setAdding(false);
    if (err) { Alert.alert('Could not add', err.message); return; }
    setNewMember('');
    load();
  };

  const applyRole = async (m: Member, role: string) => {
    const { error: err } = await supabase.rpc('set_business_member_role', {
      p_business_id: businessId, p_member_id: m.member_id, p_role: role,
    });
    if (err) { Alert.alert('Could not change role', err.message); return; }
    load();
  };

  const removeMember = async (m: Member) => {
    const { error: err } = await supabase.rpc('remove_business_member', {
      p_business_id: businessId, p_member_id: m.member_id,
    });
    if (err) { Alert.alert('Could not remove', err.message); return; }
    useActorStore.getState().loadActors();
    load();
  };

  const onMemberPress = (m: Member) => {
    const isMe = m.member_id === myId;

    // Anyone may leave. Only an owner may change or remove anyone else.
    if (!isOwner) {
      if (isMe) {
        Alert.alert('Leave this business?', 'You will no longer be able to post or reply as it.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => removeMember(m) },
        ]);
      }
      return;
    }

    const buttons: any[] = [
      { text: 'Owner', onPress: () => applyRole(m, 'owner') },
      { text: 'Manager', onPress: () => applyRole(m, 'manager') },
      { text: 'Contributor', onPress: () => applyRole(m, 'contributor') },
      { text: isMe ? 'Leave this business' : 'Remove from team', style: 'destructive', onPress: () => removeMember(m) },
      { text: 'Cancel', style: 'cancel' },
    ];
    Alert.alert(m.full_name || 'Member', isMe ? 'Change your role or leave' : 'Change their role', buttons);
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <View style={s.centered}><ActivityIndicator color={light.brand.base} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="chevron-left" size={26} color={light.ink.primary} />
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{profile?.full_name || 'Business'}</Text>
        <TouchableOpacity onPress={saveInfo} disabled={saving} style={[s.saveBtn, saving && s.saveBtnOff]}>
          {saving ? <ActivityIndicator size="small" color={light.ink.inverse} /> : <Text style={s.saveTxt}>Save</Text>}
        </TouchableOpacity>
      </View>

      {error ? <View style={s.errBar}><Text style={s.errTxt}>{error}</Text></View> : null}

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
        >
          <View style={s.topRow}>
            <TouchableOpacity
              style={s.viewProfile}
              onPress={() => navigation.navigate('UserProfile', { userId: businessId })}
              activeOpacity={0.75}
            >
              <Feather name="external-link" size={14} color={light.status.link} />
              <Text style={s.viewProfileTxt}>View public profile</Text>
            </TouchableOpacity>
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14, backgroundColor: '#0B1E3D' }}
          activeOpacity={0.88}
          onPress={() => (navigation as any).navigate('BusinessInbox', { businessId: profile?.id, businessName: profile?.full_name || 'Business' })}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14.5, fontWeight: '800', color: '#FFFFFF' }}>Open inbox</Text>
              {inboxUnread > 0 && (
                <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8 }}>
                  <Text style={{ color: '#FFF', fontSize: 11.5, fontWeight: '800' }}>{inboxUnread > 99 ? '99+' : inboxUnread}</Text>
                </View>
              )}
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>Customer messages · replies send as the business</Text>
          </View>
          <Text style={{ fontSize: 20, color: 'rgba(201,191,176,0.9)', fontWeight: '600' }}>{'›'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(11,30,61,0.16)', backgroundColor: '#FFFFFF' }}
          activeOpacity={0.88}
          onPress={() => (navigation as any).navigate('Campaigns', { businessId: profile?.id, businessName: profile?.full_name || 'Business' })}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14.5, fontWeight: '800', color: '#0B1E3D' }}>Campaigns</Text>
            <Text style={{ fontSize: 12, color: 'rgba(11,30,61,0.5)', marginTop: 1 }}>Promote posts into the feed · live reach and clicks</Text>
          </View>
          <Text style={{ fontSize: 20, color: 'rgba(11,30,61,0.35)', fontWeight: '600' }}>{'›'}</Text>
        </TouchableOpacity>
            {myRole ? <View style={s.roleChip}><Text style={s.roleTxt}>{myRole}</Text></View> : null}
          </View>

          <Text style={s.sectionLbl}>Messaging</Text>
          <Text style={s.sectionHint}>Answer even when you are away.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#0B1E3D' }}>Away message</Text>
            <Switch value={awayOn} onValueChange={v => { setAwayOn(v); saveAway(v, awayMsg); }} />
          </View>
          {awayOn ? (
            <TextInput value={awayMsg} onChangeText={setAwayMsg} onBlur={() => saveAway(awayOn, awayMsg)}
              placeholder="Thanks for reaching out. We reply during business hours."
              placeholderTextColor="#9AA6B8" multiline
              style={{ borderWidth: 1, borderColor: '#E1E6EE', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13.5, color: '#0B1E3D', minHeight: 64, textAlignVertical: 'top', marginBottom: 14 }} />
          ) : <View style={{ height: 6 }} />}
          <Text style={s.sectionLbl}>Category</Text>
          <View style={s.chips}>
            {CATEGORIES.map(c => {
              const on = category === c;
              return (
                <TouchableOpacity key={c} style={[s.chip, on && s.chipOn]} onPress={() => setCategory(c)} activeOpacity={0.8}>
                  <Text style={[s.chipTxt, on && s.chipTxtOn]}>{c}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[s.sectionLbl, { marginTop: space.lg }]}>Contact</Text>
          <TextInput value={phone} onChangeText={setPhone} style={s.input} placeholder="Phone" placeholderTextColor={light.ink.faint} keyboardType="phone-pad" />
          <TextInput value={email} onChangeText={setEmail} style={s.input} placeholder="Email" placeholderTextColor={light.ink.faint} autoCapitalize="none" keyboardType="email-address" />
          <TextInput value={website} onChangeText={setWebsite} style={s.input} placeholder="Website" placeholderTextColor={light.ink.faint} autoCapitalize="none" keyboardType="url" />
          <TextInput value={address} onChangeText={setAddress} style={s.input} placeholder="Street address" placeholderTextColor={light.ink.faint} />
          <TextInput value={location} onChangeText={setLocation} style={s.input} placeholder="City" placeholderTextColor={light.ink.faint} autoCapitalize="words" />

          <Text style={[s.sectionLbl, { marginTop: space.lg }]}>Opening hours</Text>
          <Text style={s.sectionHint}>The first thing anyone checks about a shop.</Text>
          {DAYS.map(d => {
            const open = (hours[d.key]?.length ?? 0) > 0;
            const range = hours[d.key]?.[0] ?? ['08:00', '17:00'];
            const invalid = open && (!isValidTime(range[0]) || !isValidTime(range[1]));
            return (
              <View key={d.key} style={s.dayRow}>
                <Text style={s.dayLbl}>{d.label}</Text>
                {open ? (
                  <View style={s.timeRow}>
                    <TextInput
                      value={range[0]} onChangeText={v => setDayTime(d.key, 0, v)}
                      style={[s.time, invalid && s.timeBad]} placeholder="08:00"
                      placeholderTextColor={light.ink.faint} keyboardType="number-pad" maxLength={5}
                    />
                    <Text style={s.dash}>to</Text>
                    <TextInput
                      value={range[1]} onChangeText={v => setDayTime(d.key, 1, v)}
                      style={[s.time, invalid && s.timeBad]} placeholder="17:00"
                      placeholderTextColor={light.ink.faint} keyboardType="number-pad" maxLength={5}
                    />
                  </View>
                ) : (
                  <Text style={s.closed}>Closed</Text>
                )}
                <Switch value={open} onValueChange={v => setDayOpen(d.key, v)} trackColor={{ true: light.brand.base, false: light.surface.hairline }} />
              </View>
            );
          })}

          <Text style={[s.sectionLbl, { marginTop: space.lg }]}>Team</Text>
          <Text style={s.sectionHint}>
            {isOwner
              ? 'People who can post and reply as this business. Tap someone to change their role.'
              : 'People who can post and reply as this business. Only an owner can change the team.'}
          </Text>

          {members.map(m => {
            const isMe = m.member_id === myId;
            const tappable = isOwner || isMe;
            return (
              <TouchableOpacity
                key={m.member_id}
                style={s.memberRow}
                onPress={() => onMemberPress(m)}
                activeOpacity={tappable ? 0.75 : 1}
                disabled={!tappable}
              >
                {m.avatar_url ? (
                  <Image source={{ uri: m.avatar_url }} style={s.avatar} />
                ) : (
                  <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{initials(m.full_name)}</Text></View>
                )}
                <View style={s.memberText}>
                  <Text style={s.memberName} numberOfLines={1}>
                    {m.full_name || 'User'}{isMe ? ' (you)' : ''}
                  </Text>
                  {m.username ? <Text style={s.memberHandle}>@{m.username}</Text> : null}
                </View>
                <View style={s.roleChip}><Text style={s.roleTxt}>{m.role}</Text></View>
                {tappable ? <Feather name="chevron-right" size={15} color={light.ink.faint} /> : null}
              </TouchableOpacity>
            );
          })}

          {isOwner ? (
            <View style={s.addRow}>
              <TextInput
                value={newMember}
                onChangeText={v => setNewMember(v.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                style={[s.input, { flex: 1, marginBottom: 0 }]}
                placeholder="Add by username" placeholderTextColor={light.ink.faint}
                autoCapitalize="none" autoCorrect={false}
              />
              <TouchableOpacity
                style={[s.addBtn, (!newMember.trim() || adding) && s.addBtnOff]}
                onPress={addMember}
                disabled={!newMember.trim() || adding}
              >
                {adding ? <ActivityIndicator size="small" color={light.ink.inverse} /> : <Text style={s.addTxt}>Add</Text>}
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const HAIR = StyleSheet.hairlineWidth;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: light.surface.canvas },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: space.sm, gap: space.sm,
    borderBottomWidth: HAIR, borderBottomColor: light.surface.hairline,
  },
  title: { flex: 1, textAlign: 'center', fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },
  saveBtn: { minWidth: 62, alignItems: 'center', paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.full, backgroundColor: light.brand.base },
  saveBtnOff: { opacity: 0.5 },
  saveTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  errBar: { backgroundColor: light.status.dangerBg, paddingHorizontal: 14, paddingVertical: space.sm },
  errTxt: { fontSize: typeSize.caption, color: light.status.danger, fontWeight: fontWeight.semibold },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  viewProfile: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewProfileTxt: { fontSize: typeSize.caption, fontWeight: fontWeight.bold, color: light.status.link },

  sectionLbl: { fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 1.1, textTransform: 'uppercase', color: light.ink.muted, marginBottom: space.xs },
  sectionHint: { fontSize: typeSize.micro, color: light.ink.faint, marginTop: -4, marginBottom: space.sm, lineHeight: 15 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { paddingHorizontal: space.sm, paddingVertical: 7, borderRadius: radius.full, borderWidth: HAIR, borderColor: light.surface.hairline },
  chipOn: { backgroundColor: light.brand.base, borderColor: light.brand.base },
  chipTxt: { fontSize: typeSize.caption, fontWeight: fontWeight.semibold, color: light.ink.secondary },
  chipTxtOn: { color: light.ink.inverse },

  input: {
    borderWidth: HAIR, borderColor: light.surface.hairline, borderRadius: radius.md,
    paddingHorizontal: space.sm, paddingVertical: 11, marginBottom: space.xs,
    fontSize: typeSize.body, color: light.ink.primary, backgroundColor: light.surface.raised,
  },

  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
  dayLbl: { width: 84, fontSize: typeSize.caption, fontWeight: fontWeight.semibold, color: light.ink.primary },
  timeRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: {
    flex: 1, borderWidth: HAIR, borderColor: light.surface.hairline, borderRadius: radius.sm,
    paddingHorizontal: 8, paddingVertical: 7, fontSize: typeSize.caption,
    color: light.ink.primary, backgroundColor: light.surface.raised, textAlign: 'center',
  },
  timeBad: { borderColor: light.status.danger, color: light.status.danger },
  dash: { fontSize: typeSize.micro, color: light.ink.muted },
  closed: { flex: 1, fontSize: typeSize.caption, color: light.ink.faint },

  memberRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: light.surface.sunken },
  avatarFb: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.base },
  avatarTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },
  memberText: { flex: 1 },
  memberName: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: light.ink.primary },
  memberHandle: { fontSize: typeSize.micro, color: light.ink.muted },
  roleChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, backgroundColor: light.brand.tintBg },
  roleTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: light.ink.primary, textTransform: 'capitalize' },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm },
  addBtn: { paddingHorizontal: space.md, paddingVertical: 11, borderRadius: radius.md, backgroundColor: light.brand.base },
  addBtnOff: { opacity: 0.4 },
  addTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },
});