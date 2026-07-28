/**
 * StoryAudienceSheet - Instagram audience picker for the composer.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, FlatList, Image, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { storiesService } from '../../services/storiesService';

const GREEN = '#2F9E63';

type Props = {
  visible: boolean;
  onClose: () => void;
  audience: 'everyone' | 'followers' | 'close_friends' | 'only_with' | 'except';
  onChange: (a: 'everyone' | 'followers' | 'close_friends' | 'only_with' | 'except', people?: string[]) => void;
};

export default function StoryAudienceSheet({ visible, onClose, audience, onChange }: Props) {
  const [managing, setManaging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<any[]>([]);
  const [close, setClose] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) { setManaging(false); setPicking(false); setChosen(new Set()); return; }
    setLoading(true);
    Promise.all([storiesService.getFollowing(), storiesService.getCloseFriends()])
      .then(([f, c]) => { setPeople(f || []); setClose(new Set(c || [])); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible]);

  const toggle = useCallback(async (id: string) => {
    const on = !close.has(id);
    setClose(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
    try { await storiesService.setCloseFriend(id, on); } catch {
      // the server refused — the checkmark must not lie about who is a close friend
      setClose(prev => { const n = new Set(prev); if (on) n.delete(id); else n.add(id); return n; });
    }
  }, [close]);

  const Row = ({ icon, title, sub, active, onPress, tint }: any) => (
    <TouchableOpacity style={s.row} activeOpacity={0.75} onPress={onPress}>
      <View style={[s.rowIcon, tint ? { backgroundColor: tint } : null]}>
        <Feather name={icon} size={17} color={tint ? '#FFFFFF' : '#0A0A0A'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {!!sub && <Text style={s.rowSub}>{sub}</Text>}
      </View>
      {active ? <Feather name="check" size={19} color={GREEN} /> : null}
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={s.sheet}>
            <View style={s.handle} />
            {picking ? (
              <>
                <View style={s.head}>
                  <TouchableOpacity onPress={() => setPicking(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Feather name="chevron-left" size={22} color="#0A0A0A" />
                  </TouchableOpacity>
                  <Text style={s.title}>Only share with</Text>
                  <TouchableOpacity onPress={() => { onChange('only_with', Array.from(chosen)); onClose(); }} disabled={chosen.size === 0}>
                    <Text style={[s.done, chosen.size === 0 && { opacity: 0.35 }]}>Done</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={people}
                  keyExtractor={(x: any) => x.id}
                  style={{ maxHeight: 380 }}
                  ListEmptyComponent={<Text style={s.empty}>Follow people to pick them here.</Text>}
                  renderItem={({ item }) => {
                    const on = chosen.has(item.id);
                    return (
                      <TouchableOpacity style={s.person} activeOpacity={0.75}
                        onPress={() => setChosen(prev => { const n = new Set(prev); if (on) n.delete(item.id); else n.add(item.id); return n; })}>
                        {item.avatar_url
                          ? <Image source={{ uri: item.avatar_url }} style={s.avatar} />
                          : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarTxt}>{(item.full_name || '?')[0]}</Text></View>}
                        <View style={{ flex: 1 }}>
                          <Text style={s.personName} numberOfLines={1}>{item.full_name || 'Member'}</Text>
                          {!!item.username && <Text style={s.personSub}>@{item.username}</Text>}
                        </View>
                        <View style={[s.check, on && s.checkOn]}>{on ? <Feather name="check" size={14} color="#FFFFFF" /> : null}</View>
                      </TouchableOpacity>
                    );
                  }}
                />
              </>
            ) : !managing ? (
              <>
                <Text style={s.title}>Story audience</Text>
                <Row icon="globe" title="Everyone" sub="Anyone on Platinum Circles"
                  active={audience === 'everyone'} onPress={() => { onChange('everyone'); onClose(); }} />
                <Row icon="users" title="Followers" sub="People who follow you"
                  active={audience === 'followers'} onPress={() => { onChange('followers'); onClose(); }} />
                <Row icon="star" title="Close friends" sub={close.size + ' people'} tint={GREEN}
                  active={audience === 'close_friends'} onPress={() => { onChange('close_friends'); onClose(); }} />
                <Row icon="user-check" title="Only share with" sub="Pick people just for this story"
                  active={audience === 'only_with'} onPress={() => setPicking(true)} />
                <View style={s.divider} />
                <TouchableOpacity style={s.row} activeOpacity={0.75} onPress={() => setManaging(true)}>
                  <View style={s.rowIcon}><Feather name="users" size={17} color="#0A0A0A" /></View>
                  <Text style={[s.rowTitle, { flex: 1 }]}>Manage close friends</Text>
                  <Feather name="chevron-right" size={18} color="#C7C7CC" />
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={s.head}>
                  <TouchableOpacity onPress={() => setManaging(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Feather name="chevron-left" size={22} color="#0A0A0A" />
                  </TouchableOpacity>
                  <Text style={s.title}>Close friends</Text>
                  <View style={{ width: 22 }} />
                </View>
                {loading ? (
                  <View style={s.center}><ActivityIndicator /></View>
                ) : (
                  <FlatList
                    data={people}
                    keyExtractor={(p: any) => p.id}
                    style={{ maxHeight: 380 }}
                    ListEmptyComponent={<Text style={s.empty}>Follow people to add them here.</Text>}
                    renderItem={({ item }) => {
                      const on = close.has(item.id);
                      return (
                        <TouchableOpacity style={s.person} activeOpacity={0.75} onPress={() => toggle(item.id)}>
                          {item.avatar_url
                            ? <Image source={{ uri: item.avatar_url }} style={s.avatar} />
                            : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarTxt}>{(item.full_name || '?')[0]}</Text></View>}
                          <View style={{ flex: 1 }}>
                            <Text style={s.personName} numberOfLines={1}>{item.full_name || 'Member'}</Text>
                            {!!item.username && <Text style={s.personSub}>@{item.username}</Text>}
                          </View>
                          <View style={[s.check, on && s.checkOn]}>
                            {on ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
                          </View>
                        </TouchableOpacity>
                      );
                    }}
                  />
                )}
              </>
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D8D8DC', alignSelf: 'center', marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '800', color: '#0A0A0A', letterSpacing: -0.4, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#0A0A0A', letterSpacing: -0.2 },
  rowSub: { fontSize: 13, color: '#8E8E93', marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E5EA', marginVertical: 6 },
  center: { paddingVertical: 40, alignItems: 'center' },
  empty: { fontSize: 14, color: '#8E8E93', textAlign: 'center', paddingVertical: 30 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#E5E5EA' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 16, fontWeight: '700', color: '#8E8E93' },
  personName: { fontSize: 15.5, fontWeight: '500', color: '#0A0A0A' },
  personSub: { fontSize: 13, color: '#8E8E93', marginTop: 1 },
  done: { fontSize: 15.5, fontWeight: '700', color: '#3797F0' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: GREEN, borderColor: GREEN },
});