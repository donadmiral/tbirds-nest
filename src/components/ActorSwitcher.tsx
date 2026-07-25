/**
 * ActorSwitcher
 *
 * Who this post will be published as. Renders nothing when the person has no
 * businesses, so it costs nothing until it is useful.
 *
 * Deliberately only appears on create surfaces. Switching actor changes what
 * you make, never what you read, so there is no global account switcher.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActorStore, type Actor } from '../stores/actorStore';
import { light, typeSize, fontWeight, radius, space } from '../constants/tokens';

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function Avatar({ actor, size }: { actor: Actor; size: number }) {
  const st = { width: size, height: size, borderRadius: size / 2 };
  if (actor.avatar_url) return <Image source={{ uri: actor.avatar_url }} style={[st, s.avatarBase]} />;
  return (
    <View style={[st, s.avatarBase, s.avatarFallback]}>
      <Text style={[s.avatarTxt, { fontSize: size * 0.36 }]}>{initials(actor.full_name)}</Text>
    </View>
  );
}

export default function ActorSwitcher() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const actors = useActorStore(st => st.actors);
  const actorId = useActorStore(st => st.actorId);
  const setActor = useActorStore(st => st.setActor);

  // Nothing to switch between.
  if (actors.length < 2) return null;

  const current = actors.find(a => a.actor_id === actorId) ?? actors[0];

  return (
    <>
      <TouchableOpacity
        style={s.chip}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`Posting as ${current?.full_name ?? 'you'}. Change.`}
      >
        <Avatar actor={current} size={20} />
        <Text style={s.chipTxt} numberOfLines={1}>
          {current?.kind === 'business' ? current.full_name : 'You'}
        </Text>
        <Feather name="chevron-down" size={13} color={light.ink.muted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setOpen(false)}>
          <Pressable style={[s.sheet, { paddingBottom: insets.bottom + space.md }]} onPress={() => {}}>
            <View style={s.handle} />
            <Text style={s.title}>Post as</Text>
            <Text style={s.subtitle}>
              This changes who authors the post. Your feed stays yours either way.
            </Text>

            {actors.map(a => {
              const on = a.actor_id === current?.actor_id;
              return (
                <TouchableOpacity
                  key={a.actor_id}
                  style={[s.row, on && s.rowOn]}
                  activeOpacity={0.75}
                  onPress={() => { setActor(a.actor_id); setOpen(false); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Avatar actor={a} size={40} />
                  <View style={s.rowText}>
                    <Text style={s.rowName} numberOfLines={1}>
                      {a.kind === 'business' ? a.full_name : `${a.full_name} (you)`}
                    </Text>
                    <Text style={s.rowMeta} numberOfLines={1}>
                      {a.username ? `@${a.username}` : ''}
                      {a.kind === 'business' && a.role ? `  ·  ${a.role}` : ''}
                    </Text>
                  </View>
                  {on ? <Feather name="check" size={18} color={light.brand.base} /> : null}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const HAIR = StyleSheet.hairlineWidth;

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingLeft: 4, paddingRight: 9, paddingVertical: 4,
    borderRadius: radius.full, borderWidth: HAIR, borderColor: light.surface.hairline,
    backgroundColor: light.surface.raised, maxWidth: 190,
  },
  chipTxt: { flexShrink: 1, fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: light.ink.primary },

  avatarBase: { backgroundColor: light.surface.sunken },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.warm },
  avatarTxt: { fontWeight: fontWeight.heavy, color: light.brand.base },

  overlay: { flex: 1, backgroundColor: light.surface.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: light.surface.canvas,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: space.md, paddingTop: space.sm,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: light.surface.hairline, marginBottom: space.sm },
  title: { fontSize: typeSize.title, fontWeight: fontWeight.heavy, color: light.ink.primary, letterSpacing: -0.4 },
  subtitle: { fontSize: typeSize.caption, color: light.ink.muted, marginTop: 2, marginBottom: space.md, lineHeight: 17 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: space.sm, paddingHorizontal: space.xs,
    borderRadius: radius.md, marginBottom: 2,
  },
  rowOn: { backgroundColor: light.brand.tintBg },
  rowText: { flex: 1 },
  rowName: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: light.ink.primary },
  rowMeta: { fontSize: typeSize.micro, color: light.ink.muted, marginTop: 1 },
});