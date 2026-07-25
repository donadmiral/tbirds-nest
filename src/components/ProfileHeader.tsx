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
 * What stays ours: stats as a rail of platinum-tinted pills rather than grey
 * inline text nobody notices, a platinum underline on the active tab, and a
 * fourth pill on your own profile showing total reach.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { light, typeSize, fontWeight, radius, space } from '../constants/tokens';

const BANNER_H = 150;
const AVATAR = 78;

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
  onOpenInsights?: () => void;
  actions?: React.ReactNode;
};

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function fmt(n?: number | null) {
  if (n == null) return '0';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function joinedLabel(iso?: string) {
  if (!iso) return null;
  return `Joined ${new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
}

export default function ProfileHeader({
  profile, stats, uploadingPhoto, isSelf = true, tabs, activeTab, onTabChange,
  onSettings, onEdit, onChangePhoto, onOpenStats, onOpenInsights, actions,
}: Props) {
  const business = profile?.account_type === 'business' ? (profile.business || null) : null;
  const joined = joinedLabel(profile?.created_at || profile?.joined_at);

  return (
    <View>
      <View style={s.banner}>
        {profile?.banner_url ? (
          <ExpoImage
            source={{ uri: profile.banner_url }}
            style={s.bannerImg}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
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
        <View style={s.avatarRow}>
          <TouchableOpacity
            onPress={onChangePhoto}
            disabled={!onChangePhoto || uploadingPhoto}
            activeOpacity={0.85}
          >
            {uploadingPhoto ? (
              <View style={[s.avatar, s.avatarLoading]}><ActivityIndicator color={light.brand.base} /></View>
            ) : profile?.avatar_url ? (
              <ExpoImage source={{ uri: profile.avatar_url }} style={s.avatar} contentFit="cover" cachePolicy="memory-disk" transition={150} />
            ) : (
              <View style={[s.avatar, s.avatarFallback]}>
                <Text style={s.avatarTxt}>{initials(profile?.full_name)}</Text>
              </View>
            )}
          </TouchableOpacity>

          {actions ? actions : onEdit ? (
            <TouchableOpacity style={s.editBtn} onPress={onEdit} activeOpacity={0.8} accessibilityRole="button">
              <Feather name="edit-2" size={12} color={light.ink.primary} />
              <Text style={s.editTxt}>Edit profile</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>{profile?.full_name || 'Your Name'}</Text>
          {profile?.is_verified ? <Feather name="check-circle" size={15} color={light.brand.warm} /> : null}
        </View>
        {profile?.username ? <Text style={s.handle}>@{profile.username}</Text> : null}

        {business?.category ? <Text style={s.category}>{business.category}</Text> : null}
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

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
          <TouchableOpacity style={s.pill} activeOpacity={0.75} onPress={() => onOpenStats?.('followers')}>
            <Text style={s.pillNum}>{fmt(stats?.followers)}</Text>
            <Text style={s.pillLbl}>Followers</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.pill} activeOpacity={0.75} onPress={() => onOpenStats?.('following')}>
            <Text style={s.pillNum}>{fmt(stats?.following)}</Text>
            <Text style={s.pillLbl}>Following</Text>
          </TouchableOpacity>
          <View style={s.pill}>
            <Text style={s.pillNum}>{fmt(stats?.posts)}</Text>
            <Text style={s.pillLbl}>Posts</Text>
          </View>
          {isSelf && stats?.reach != null ? (
            <TouchableOpacity style={[s.pill, s.pillAccent]} activeOpacity={0.75} onPress={onOpenInsights}>
              <Text style={s.pillNum}>{fmt(stats.reach)}</Text>
              <Text style={s.pillLbl}>Reached</Text>
            </TouchableOpacity>
          ) : null}
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

const s = StyleSheet.create({
  banner: { height: BANNER_H, backgroundColor: light.brand.base },
  bannerImg: { width: '100%', height: '100%' },
  bannerFallback: { backgroundColor: light.brand.base },
  settingsBtn: {
    position: 'absolute', top: 12, right: 14,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(11,30,61,0.42)',
    alignItems: 'center', justifyContent: 'center',
  },

  body: { paddingHorizontal: 14 },
  avatarRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    marginTop: -(AVATAR / 2), marginBottom: space.xs,
  },
  avatar: {
    width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2,
    borderWidth: 3, borderColor: light.surface.canvas,
    backgroundColor: light.surface.sunken,
  },
  avatarLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.surface.canvas },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.warm },
  avatarTxt: { fontSize: typeSize.title, fontWeight: fontWeight.heavy, color: light.brand.base },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: space.sm, paddingVertical: 7, marginBottom: 4,
    borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: light.surface.hairline,
  },
  editTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: light.ink.primary },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { fontSize: typeSize.title, fontWeight: fontWeight.heavy, color: light.ink.primary, letterSpacing: -0.5 },
  handle: { fontSize: typeSize.caption, color: light.ink.muted, marginTop: 1 },

  category: {
    fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 1.1,
    textTransform: 'uppercase', color: light.brand.warm, marginTop: 5,
  },
  headline: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: light.ink.primary, marginTop: 5 },
  bio: { fontSize: typeSize.body, color: light.ink.secondary, lineHeight: 20, marginTop: 5 },
  bioEmpty: { fontSize: typeSize.body, color: light.status.link, fontWeight: fontWeight.semibold, marginTop: 5 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 230 },
  meta: { fontSize: typeSize.caption, color: light.ink.muted },

  rail: { gap: space.xs, paddingTop: space.sm, paddingBottom: space.sm },
  pill: {
    alignItems: 'center', minWidth: 78,
    paddingHorizontal: space.sm, paddingVertical: space.xs,
    borderRadius: radius.md, backgroundColor: light.brand.tintBg,
  },
  pillAccent: { backgroundColor: 'rgba(201,191,176,0.30)' },
  pillNum: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },
  pillLbl: { fontSize: typeSize.micro, color: light.ink.muted, marginTop: 1 },

  tabRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: light.surface.hairline },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.sm },
  tabTxt: { fontSize: typeSize.caption, fontWeight: fontWeight.semibold, color: light.ink.muted },
  tabTxtOn: { color: light.ink.primary, fontWeight: fontWeight.heavy },
  tabBar: { position: 'absolute', bottom: -1, height: 2.5, width: 34, borderRadius: 2, backgroundColor: light.brand.warm },
});
