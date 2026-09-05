import { getTierColor } from './VerifiedBadge';
import VerifiedBadge from './VerifiedBadge';
/**
 * ProfileHeader
 *
 * X's information architecture, deliberately not X's look.
 *
 * The banner is never covered. An earlier version put the name on the image
 * behind a scrim, which meant half of every banner was tinted. The banner is
 * the user's content, not a backdrop, so the name sits below it and the avatar
 * overlaps the boundary instead.
 *
 * Ours: stats as a rail of platinum-tinted pills rather than grey inline text,
 * a platinum underline on the active tab, a reach pill on your own profile, and
 * live opening hours on a business.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Modal, Share, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { light, typeSize, fontWeight, radius, space } from '../constants/tokens';
import { supabase } from '../services/supabase';
import { openNow, hoursSummary, hasHours, DAY_ORDER, dayLabel } from '../utils/businessHours';
import PlatinumRing from './stories/PlatinumRing';

const BANNER_H = 164;
const AVATAR = 92;
const RING = AVATAR + 14;

type Tab = { key: string; label: string };

type Props = {
  profile: any;
  stats: { posts: number; followers: number; following: number; reach?: number | null };
  uploadingPhoto?: boolean;
  isSelf?: boolean;
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  onSettings?: () => void;
  onEdit?: () => void;
  onChangePhoto?: () => void;
  onOpenStats?: (kind: 'followers' | 'following') => void;
  hasStory?: boolean;
  onOpenStory?: () => void;
  onOpenInsights?: () => void;
  actions?: React.ReactNode;
};

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : p[0][0].toUpperCase() + p[1][0].toUpperCase();
}

function fmt(n?: number | null) {
  if (n == null) return '0';
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function joinedLabel(iso?: string) {
  if (!iso) return null;
  return 'Joined ' + new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Live open or closed, with the week available on tap. */
function BusinessHours({ hours }: { hours: any }) {
  const [open, setOpen] = useState(false);
  if (!hasHours(hours)) return null;
  const isOpen = openNow(hours);
  const summary = hoursSummary(hours);

  return (
    <View style={s.hoursWrap}>
      <TouchableOpacity
        style={s.hoursRow}
        onPress={() => setOpen(v => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={isOpen ? 'Open now. Show opening hours.' : 'Closed. Show opening hours.'}
      >
        <Feather name="clock" size={12} color={light.ink.muted} />
        <Text style={[s.hoursState, isOpen ? s.hoursOpen : s.hoursClosed]}>
          {isOpen ? 'Open' : 'Closed'}
        </Text>
        <Text style={s.meta}>{summary}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={13} color={light.ink.faint} />
      </TouchableOpacity>

      {open ? (
        <View style={s.hoursWeek}>
          {DAY_ORDER.map(k => {
            const r = hours?.[k]?.[0];
            return (
              <View key={k} style={s.hoursDay}>
                <Text style={s.hoursDayLbl}>{dayLabel(k)}</Text>
                <Text style={s.hoursDayVal}>{r ? r[0] + ' - ' + r[1] : 'Closed'}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export default function ProfileHeader({
  profile, stats, uploadingPhoto, isSelf = true, tabs, activeTab, onTabChange,
  onSettings, onEdit, onChangePhoto, onOpenStats, onOpenInsights, actions,
  hasStory, onOpenStory,
}: Props) {
  const business = profile?.account_type === 'business' ? (profile.business || null) : null;
  const joined = joinedLabel(profile?.created_at || profile?.joined_at);
  const [ctxMutual, setCtxMutual] = useState<string | null>(null);
  const [ctxInsights, setCtxInsights] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  // Profile links: read straight from profiles, so get_profile stays untouched.
  const [profileLinks, setProfileLinks] = useState<{ title: string; url: string }[]>([]);
  useEffect(() => {
    let alive = true;
    const pid = (profile as any)?.id;
    if (!pid) { setProfileLinks([]); return; }
    supabase.from('profiles').select('links').eq('id', pid).maybeSingle().then(({ data }) => {
      if (!alive) return;
      const raw = Array.isArray((data as any)?.links) ? ((data as any).links as any[]) : [];
      setProfileLinks(raw.filter(l => l && l.url).slice(0, 5).map(l => ({ title: String(l.title || ''), url: String(l.url) })));
    });
    return () => { alive = false; };
  }, [(profile as any)?.id]);
  const hostOf = (u: string) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
  useEffect(() => {
    let alive = true;
    const pid = profile?.id;
    if (!pid) return;
    (async () => {
      try {
        if (isSelf) {
          const { data } = await supabase.rpc('get_profile_insights', { p_profile: pid });
          if (alive && data && typeof (data as any).views_30d === 'number') setCtxInsights(String((data as any).views_30d) + ' profile views in the last 30 days');
        } else {
          const { data } = await supabase.rpc('get_profile_context', { p_profile: pid });
          if (alive && data) {
            const names: string[] = Array.isArray((data as any).mutual_names) ? (data as any).mutual_names : [];
            const extra = Math.max(0, ((data as any).mutual_count || 0) - names.length);
            if (names.length > 0) setCtxMutual('Followed by ' + names.join(', ') + (extra > 0 ? ' and ' + extra + ' more' : ''));
          }
        }
      } catch {}
    })();
    return () => { alive = false; };
  }, [profile?.id, isSelf]);
  const shareProfile = async () => {
    try { await Share.share({ message: 'Follow ' + (profile?.username ? '@' + profile.username : (profile?.full_name || 'this member')) + ' on Platinum Circles' }); } catch {}
  };

  return (
    <View>
      <View style={s.banner}>
        {profile?.banner_url ? (
          <ExpoImage source={{ uri: profile.banner_url }} style={s.bannerImg} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[s.bannerImg, s.bannerFallback]} />
        )}

        {onSettings ? (
          <TouchableOpacity
            style={s.settingsBtn}
            onPress={onSettings}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Feather name="settings" size={17} color={light.ink.inverse} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={s.body}>
        <View style={s.medallionWrap}>
          <TouchableOpacity
            onPress={hasStory && onOpenStory ? onOpenStory : onChangePhoto}
            disabled={uploadingPhoto || (!onChangePhoto && !(hasStory && onOpenStory))}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={hasStory ? 'View story' : 'Change profile photo'}
          >
            <View style={s.ringHolder}>
              <View style={s.ringSvg} pointerEvents="none">
                <PlatinumRing userId={profile?.id || 'me'} size={RING} active={!!hasStory} />
              </View>
              {uploadingPhoto ? (
                <View style={[s.avatar, s.avatarLoading]}><ActivityIndicator color={light.brand.base} /></View>
              ) : profile?.avatar_url ? (
                ((!isSelf) ? (<TouchableOpacity activeOpacity={0.9} onPress={() => setAvatarOpen(true)}><ExpoImage source={{ uri: profile.avatar_url }} style={s.avatar} contentFit="cover" cachePolicy="memory-disk" transition={150} /></TouchableOpacity>) : (<ExpoImage source={{ uri: profile.avatar_url }} style={s.avatar} contentFit="cover" cachePolicy="memory-disk" transition={150} />))
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Text style={s.avatarTxt}>{initials(profile?.full_name)}</Text>
                </View>
              )}
              {onChangePhoto && hasStory ? (
                <TouchableOpacity style={s.cameraChip} onPress={onChangePhoto} activeOpacity={0.85} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Feather name="camera" size={11} color={light.ink.inverse} />
                </TouchableOpacity>
              ) : null}
            </View>
          </TouchableOpacity>
        </View>

        <View style={s.nameRow}>
          <Text style={[s.name, getTierColor((profile as any)?.verified_tier ?? ((profile as any)?.is_verified ? 'business' : null)) ? { color: getTierColor((profile as any)?.verified_tier ?? ((profile as any)?.is_verified ? 'business' : null)) as string } : null]} numberOfLines={1}>{profile?.full_name || 'Your Name'}</Text>
          {(profile?.verified_tier || profile?.is_verified) ? <VerifiedBadge tier={profile?.verified_tier} size={17} /> : null}
        </View>
        {profile?.username ? <Text style={s.handle}>@{profile.username}</Text> : null}
        {ctxMutual ? <Text style={{ fontSize: 13, color: '#8E8E93', marginTop: 5, textAlign: 'center', paddingHorizontal: 24 }}>{ctxMutual}</Text> : null}
        {isSelf && ctxInsights ? <Text style={{ fontSize: 12.5, color: '#8E8E93', marginTop: 5, textAlign: 'center' }}>{ctxInsights}</Text> : null}
        {profile?.username ? <TouchableOpacity onPress={shareProfile} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'center', marginTop: 8, paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(11,30,61,0.06)' }}><Feather name="share" size={12} color="#0B1E3D" /><Text style={{ fontSize: 12.5, fontWeight: '700', color: '#0B1E3D' }}>Share profile</Text></TouchableOpacity> : null}
        <Modal visible={avatarOpen} transparent animationType="fade" onRequestClose={() => setAvatarOpen(false)}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' }} activeOpacity={1} onPress={() => setAvatarOpen(false)}>
            {profile?.avatar_url ? <ExpoImage source={{ uri: profile.avatar_url }} style={{ width: '92%', height: '70%' }} contentFit="contain" /> : null}
          </TouchableOpacity>
        </Modal>

        {actions ? (
          <View style={s.actionsCenter}>{actions}</View>
        ) : onEdit ? (
          <View style={s.actionsCenter}>
            <TouchableOpacity style={s.editBtn} onPress={onEdit} activeOpacity={0.8} accessibilityRole="button">
              <Feather name="edit-2" size={12} color={light.ink.primary} />
              <Text style={s.editTxt}>Edit profile</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {business?.category ? <Text style={s.category}>{business.category}</Text> : null}
        {(() => { const c = (profile as any)?.account_class; const lb = (profile as any)?.account_labels || {}; const chips: string[] = []; if (c === 'creator') chips.push('Creator'); if (c === 'organization') chips.push('Organization'); if (c === 'automated') chips.push('Automated'); if (lb?.parody) chips.push('Parody'); if (lb?.fan) chips.push('Fan account'); if (lb?.commentary) chips.push('Commentary'); if (lb?.memorialized) chips.push('Remembering'); if (!chips.length) return null; return (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {chips.map(ch => <View key={ch} style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(201,191,176,0.28)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.14)' }}><Text style={{ fontSize: 11, fontWeight: '700', color: '#0B1E3D', letterSpacing: 0.2 }}>{ch}</Text></View>)}
          </View>
        ); })()}
        {profile?.headline ? <Text style={s.headline}>{profile.headline}</Text> : null}

        {profile?.bio ? (
          <Text style={s.bio}>{profile.bio}</Text>
        ) : onEdit ? (
          <TouchableOpacity onPress={onEdit}><Text style={s.bioEmpty}>Add a bio</Text></TouchableOpacity>
        ) : null}

        <View style={s.metaRow}>
          {profile?.workplace ? (
            <View style={s.metaItem}>
              <Feather name="briefcase" size={12} color={light.ink.muted} />
              <Text style={s.meta}>{profile.workplace}</Text>
            </View>
          ) : null}
          {profile?.location ? (
            <View style={s.metaItem}>
              <Feather name="map-pin" size={12} color={light.ink.muted} />
              <Text style={s.meta}>{profile.location}</Text>
            </View>
          ) : null}
          {joined ? (
            <View style={s.metaItem}>
              <Feather name="calendar" size={12} color={light.ink.muted} />
              <Text style={s.meta}>{joined}</Text>
            </View>
          ) : null}
        </View>

        {profileLinks.length > 0 ? (
          <View style={[s.metaRow, { marginTop: space.sm }]}>
            {profileLinks.map((l, i) => (
              <TouchableOpacity key={i} onPress={() => Linking.openURL(l.url).catch(() => {})} activeOpacity={0.8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(11,30,61,0.16)', backgroundColor: '#FFFFFF' }}>
                <Feather name="link" size={12} color={light.ink.primary} />
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: light.ink.primary }} numberOfLines={1}>{l.title || hostOf(l.url)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {business ? (
          <View style={s.metaRow}>
            {business.phone ? (
              <View style={s.metaItem}><Feather name="phone" size={12} color={light.ink.muted} /><Text style={s.meta}>{business.phone}</Text></View>
            ) : null}
            {business.website ? (
              <View style={s.metaItem}><Feather name="globe" size={12} color={light.ink.muted} /><Text style={s.meta} numberOfLines={1}>{business.website}</Text></View>
            ) : null}
            {business.address ? (
              <View style={s.metaItem}><Feather name="navigation" size={12} color={light.ink.muted} /><Text style={s.meta} numberOfLines={1}>{business.address}</Text></View>
            ) : null}
          </View>
        ) : null}

        {business ? <BusinessHours hours={business.hours} /> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
          <View style={s.capsule}>
            <TouchableOpacity style={s.seg} activeOpacity={0.75} onPress={() => onOpenStats?.('followers')}>
              <Text style={s.pillNum}>{fmt(stats?.followers)}</Text>
              <Text style={s.pillLbl}>Followers</Text>
            </TouchableOpacity>
            {!business ? (
              <TouchableOpacity style={s.seg} activeOpacity={0.75} onPress={() => onOpenStats?.('following')}>
                <Text style={s.pillNum}>{fmt(stats?.following)}</Text>
                <Text style={s.pillLbl}>Following</Text>
              </TouchableOpacity>
            ) : null}
            <View style={s.seg}>
              <Text style={s.pillNum}>{fmt(stats?.posts)}</Text>
              <Text style={s.pillLbl}>Posts</Text>
            </View>
            {business && business.review_count > 0 ? (
              <View style={[s.seg, s.segAccent]}>
                <Text style={s.pillNum}>{Number(business.avg_rating ?? 0).toFixed(1)}</Text>
                <Text style={s.pillLbl}>Rating</Text>
              </View>
            ) : null}
            {isSelf && stats?.reach != null ? (
              <TouchableOpacity style={[s.seg, s.segAccent]} activeOpacity={0.75} onPress={onOpenInsights}>
                <Text style={s.pillNum}>{fmt(stats.reach)}</Text>
                <Text style={s.pillLbl}>Reached {'\u00b7'} 28 days</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </View>

      <View style={[s.tabRow, tabs.length === 0 && { borderBottomWidth: 0 }]}>
        {tabs.map(t => {
          const on = activeTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={s.tab}
              onPress={() => onTabChange(t.key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.tabTxt, on && s.tabTxtOn]}>{t.label}</Text>
              {on ? <View style={s.tabBar} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const HAIR = StyleSheet.hairlineWidth;

const s = StyleSheet.create({
  banner: { height: BANNER_H, backgroundColor: light.brand.base, borderBottomWidth: 2, borderBottomColor: light.brand.warm },
  bannerImg: { width: '100%', height: '100%' },
  bannerFallback: { backgroundColor: light.brand.base },
  settingsBtn: {
    position: 'absolute', top: 12, right: 14,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(11,30,61,0.42)',
    alignItems: 'center', justifyContent: 'center',
  },

  body: { paddingHorizontal: 14 },
  medallionWrap: { alignItems: 'center', marginTop: -(RING / 2) - 2, marginBottom: space.xs },
  ringHolder: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringSvg: { position: 'absolute', top: 0, left: 0 },
  cameraChip: {
    position: 'absolute', bottom: 3, right: 3, width: 24, height: 24, borderRadius: 12,
    backgroundColor: light.brand.base, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: light.surface.canvas,
  },
  avatar: {
    width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2,
    borderWidth: 3, borderColor: light.surface.canvas, backgroundColor: light.surface.sunken,
  },
  avatarLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.surface.canvas },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.warm },
  avatarTxt: { fontSize: typeSize.title, fontWeight: fontWeight.heavy, color: light.brand.base },
  actionsCenter: { alignItems: 'center', marginTop: space.sm },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: space.md, paddingVertical: 7,
    borderRadius: radius.full, borderWidth: HAIR, borderColor: light.surface.hairline,
  },
  editTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: light.ink.primary },

  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1 },
  name: { fontSize: 22, fontWeight: fontWeight.heavy, color: light.ink.primary, letterSpacing: -0.6, textAlign: 'center' },
  handle: { fontSize: typeSize.caption, color: light.ink.muted, marginTop: 1, textAlign: 'center' },

  category: {
    fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 1.1,
    textTransform: 'uppercase', color: light.brand.warm, marginTop: 5, textAlign: 'center',
  },
  headline: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: light.ink.primary, marginTop: 5, textAlign: 'center' },
  bio: { fontSize: typeSize.body, color: light.ink.secondary, lineHeight: 20, marginTop: 5 },
  bioEmpty: { fontSize: typeSize.body, color: light.status.link, fontWeight: fontWeight.semibold, marginTop: 5 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 230 },
  meta: { fontSize: typeSize.caption, color: light.ink.muted },

  hoursWrap: { marginTop: space.xs },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  hoursState: { fontSize: typeSize.caption, fontWeight: fontWeight.bold },
  hoursOpen: { color: light.status.success },
  hoursClosed: { color: light.status.danger },
  hoursWeek: { marginTop: 6, paddingLeft: 17, gap: 3 },
  hoursDay: { flexDirection: 'row', justifyContent: 'space-between', maxWidth: 240 },
  hoursDayLbl: { fontSize: typeSize.micro, color: light.ink.muted },
  hoursDayVal: { fontSize: typeSize.micro, color: light.ink.secondary, fontWeight: fontWeight.medium },

  rail: { flexGrow: 1, justifyContent: 'center', paddingTop: space.sm, paddingBottom: space.sm },
  capsule: {
    flexDirection: 'row', borderRadius: radius.full, overflow: 'hidden',
    borderWidth: HAIR, borderColor: light.surface.hairline, backgroundColor: light.brand.tintBg,
  },
  seg: {
    alignItems: 'center', minWidth: 84,
    paddingHorizontal: space.sm, paddingVertical: space.xs,
    borderLeftWidth: HAIR, borderLeftColor: light.surface.hairline,
  },
  segAccent: { backgroundColor: 'rgba(201,191,176,0.30)' },
  pillNum: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },
  pillLbl: { fontSize: typeSize.micro, color: light.ink.muted, marginTop: 1 },

  tabRow: { flexDirection: 'row', borderBottomWidth: HAIR, borderBottomColor: light.surface.hairline },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.sm },
  tabTxt: { fontSize: typeSize.caption, fontWeight: fontWeight.semibold, color: light.ink.muted },
  tabTxtOn: { color: light.ink.primary, fontWeight: fontWeight.heavy },
  tabBar: { position: 'absolute', bottom: -1, height: 2.5, width: 34, borderRadius: 2, backgroundColor: light.brand.warm },
});