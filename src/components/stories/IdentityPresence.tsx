import VerifiedBadge from '../VerifiedBadge';
/**
 * IdentityPresence.tsx
 *
 * Bottom-territory identity + top-right close button.
 * All controls meet 44px minimum touch target.
 * Close button is safe-area aware via topInset prop.
 */
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ReAnimated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

const { width: SCREEN_W } = Dimensions.get('window');

type IdentityPresenceProps = {
  user: { avatar_url?: string; full_name?: string; username?: string } | null;
  isOwn: boolean;
  timeAgo: string;
  scope?: string;
  category?: string;
  viewsCount?: number;
  chromeOpacity: SharedValue<number>;
  topInset: number;
  onOpenViewers?: () => void;
  onSaveHighlight?: () => void;
  onOpenSettings?: () => void;
  onDelete?: () => void;
  onClose: () => void;
  bottomInset: number;
};

function initialsFrom(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

const IdentityPresence = React.memo(function IdentityPresence({
  user, isOwn, timeAgo, scope, category, viewsCount, chromeOpacity,
  topInset, onOpenViewers, onSaveHighlight, onOpenSettings, onDelete, onClose, bottomInset,
}: IdentityPresenceProps) {
  const presenceStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0.5, chromeOpacity.value),
  }));

  const closeBtnStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0.5, chromeOpacity.value * 0.9),
  }));

  return (
    <>
      {/* Close: top-right, safe-area aware, 44x44 touch target */}
      <ReAnimated.View style={[s.closeBtnWrap, { top: topInset + 30 }, closeBtnStyle]}>
        <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.7}>
          <Feather name="x" size={20} color="rgba(245,240,235,0.85)" />
        </TouchableOpacity>
      </ReAnimated.View>

      {/* Identity: bottom territory */}
      <ReAnimated.View
        style={[s.container, { paddingBottom: isOwn ? 14 : Math.max(bottomInset + 62, 74) }, presenceStyle]}
        pointerEvents="box-none"
      >
        <View style={s.presenceRow}>
          <View style={s.avatarWrap}>
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={s.avatar} />
            ) : (
              <View style={[s.avatar, s.avatarFallback]}>
                <Text style={s.avatarInitials}>{initialsFrom(user?.full_name)}</Text>
              </View>
            )}
          </View>
          <View style={s.nameContext}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[s.name, { flexShrink: 1 }]} numberOfLines={1}>
                {isOwn ? 'Your moment' : (user?.full_name || 'Someone')}
              </Text>
              <VerifiedBadge userId={(user as any)?.id} size={13} />
            </View>
            <View style={s.contextRow}>
              <Text style={s.contextText}>{timeAgo}</Text>
              {isOwn && scope ? (
                <><Text style={s.contextDot}>·</Text><Text style={s.contextText}>{scope === 'institution' ? 'School' : 'Everyone'}</Text></>
              ) : user?.username ? (
                <><Text style={s.contextDot}>·</Text><Text style={s.contextText}>@{user.username}</Text></>
              ) : null}
              {category ? (
                <><Text style={s.contextDot}>·</Text><Text style={s.categoryText}>{category}</Text></>
              ) : null}
            </View>
          </View>
        </View>

        {isOwn && (
          <View style={s.ownerTerritory}>
            {onOpenViewers && (
              <TouchableOpacity style={s.viewersTap} onPress={onOpenViewers} activeOpacity={0.7}>
                <Feather name="eye" size={14} color="rgba(245,240,235,0.55)" />
                <Text style={s.viewersText}>
                  <Text style={s.viewersCount}>{viewsCount ?? 0}</Text> viewed
                </Text>
              </TouchableOpacity>
            )}
            <View style={s.ownerActions}>
              {onOpenSettings && (
                <TouchableOpacity onPress={onOpenSettings} style={s.actionCircle}>
                  <Feather name="settings" size={16} color="rgba(245,240,235,0.65)" />
                </TouchableOpacity>
              )}
              {onSaveHighlight && (
                <TouchableOpacity onPress={onSaveHighlight} style={s.actionCircle}>
                  <Feather name="bookmark" size={16} color="rgba(245,240,235,0.65)" />
                </TouchableOpacity>
              )}
              {onDelete && (
                <TouchableOpacity onPress={onDelete} style={s.actionCircle}>
                  <Feather name="trash-2" size={16} color="rgba(245,240,235,0.65)" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </ReAnimated.View>
    </>
  );
});

export default IdentityPresence;

const s = StyleSheet.create({
  // Close: 44x44 visual target, safe-area positioned
  closeBtnWrap: { position: 'absolute', right: 14, zIndex: 15 },
  closeBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },

  container: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 8, zIndex: 12,
  },

  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },

  avatarWrap: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden' },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { backgroundColor: 'rgba(245,240,235,0.1)', alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 13, fontWeight: '600', color: 'rgba(245,240,235,0.65)' },

  nameContext: { flex: 1, minWidth: 0 },
  name: {
    fontSize: 16, fontWeight: '700', color: '#FFFFFF',
    letterSpacing: -0.2,
    textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  contextRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  contextText: {
    fontSize: 13, color: 'rgba(255,255,255,0.88)', fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  contextDot: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginHorizontal: 5 },
  categoryText: {
    fontSize: 11.5, color: 'rgba(196,184,168,0.6)', fontWeight: '600', letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },

  // Owner: 44px touch targets on action circles
  ownerTerritory: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 10, paddingLeft: 47,
  },
  viewersTap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  viewersText: { fontSize: 13, color: 'rgba(245,240,235,0.45)', fontWeight: '500' },
  viewersCount: { fontWeight: '700', color: 'rgba(245,240,235,0.65)' },
  ownerActions: { flexDirection: 'row', gap: 8 },
  actionCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(3,6,16,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
});