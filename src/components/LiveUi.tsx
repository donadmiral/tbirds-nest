import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from './SafeArea';
import { useTheme } from '../theme/useTheme';
import { LIVE_TOPICS, type LiveFilter, type LiveView } from '../../shared/liveDirectory';

type Choice = readonly [string, string];
export const LIVE_AUDIENCES = [['public', 'Public'], ['followers', 'Followers'], ['invite', 'Invitation only']] as const;
const DISCOVERY = [['for_you', 'Recommended'], ['following', 'Following'], ['followers', 'Followers'], ['celebrities', 'Celebrities'], ['mine', 'My streams']] as const;
const VIEWS = [['live', 'Live'], ['scheduled', 'Upcoming'], ['replay', 'Replays']] as const;

// A camera with a recording dot is deliberately different from Channels' radio icon.
export function LiveIcon({ size = 20, color }: { size?: number; color: string }) {
  return <View accessible={false} style={{ width: size + 2, height: size, justifyContent: 'center' }}>
    <Feather name="video" size={size} color={color} />
    <View style={{ position: 'absolute', top: 0, right: 0, width: 5, height: 5, borderRadius: 3, backgroundColor: '#C43146' }} />
  </View>;
}

export function LiveChoice({ label, value, choices, onChange, disabled = false }: {
  label: string; value: string; choices: readonly Choice[]; onChange(value: string): void; disabled?: boolean;
}) {
  const { t } = useTheme(), [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${choices.find(([id]) => id === value)?.[1] || value}`}
      accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(true)}
      style={[styles.choice, { borderBottomColor: t.surface.sunken }]}>
      <Text style={{ color: t.ink.primary, fontSize: 15 }}>{label}</Text>
      <View style={styles.inline}><Text numberOfLines={1} style={{ color: t.ink.secondary, fontSize: 14, flexShrink: 1 }}>{choices.find(([id]) => id === value)?.[1] || value}</Text><Feather name="chevron-down" size={18} color={t.ink.secondary} /></View>
    </Pressable>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.surface.raised }}>
        <View style={styles.sheetHeader}><Text accessibilityRole="header" style={[styles.sheetTitle, { color: t.ink.primary }]}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Close ${label}`} onPress={() => setOpen(false)} style={styles.iconButton}><Feather name="x" size={22} color={t.ink.primary} /></Pressable></View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          {choices.map(([id, title]) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: id === value }} onPress={() => { onChange(id); setOpen(false); }} style={styles.choice}>
            <Text style={{ color: t.ink.primary, fontSize: 16 }}>{title}</Text>{id === value ? <Feather name="check" size={20} color={t.ink.primary} /> : null}
          </Pressable>)}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}

export function LiveDirectoryHeader({ filter, view, topic, query, onFilter, onView, onTopic, onQuery, onBack, onCreate, onClips, onSchedule }: {
  filter: LiveFilter; view: LiveView; topic: string; query: string;
  onFilter(value: LiveFilter): void; onView(value: LiveView): void; onTopic(value: string): void; onQuery(value: string): void;
  onBack(): void; onCreate(): void; onClips(): void; onSchedule?(): void;
}) {
  const { t } = useTheme();
  const [filtersOpen, setFiltersOpen] = useState(false), [searchOpen, setSearchOpen] = useState(false), [toolsOpen, setToolsOpen] = useState(false);
  const activeFilters = (filter !== 'for_you' ? 1 : 0) + (topic !== 'all' ? 1 : 0);
  const summary = [DISCOVERY.find(([id]) => id === filter)?.[1], topic === 'all' ? null : LIVE_TOPICS.find(([id]) => id === topic)?.[1]].filter(Boolean).join(' · ');
  return <View style={{ gap: 12 }}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to feed" onPress={onBack} style={styles.iconButton}><Feather name="chevron-left" size={24} color={t.ink.primary} /></Pressable>
      <View style={[styles.inline, { flex: 1 }]}><LiveIcon color={t.ink.primary} /><Text accessibilityRole="header" style={{ color: t.ink.primary, fontSize: 22, fontWeight: '700' }}>Live</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Your Live tools" accessibilityState={{ expanded: toolsOpen }} onPress={() => setToolsOpen(true)} style={styles.iconButton}><Feather name="more-horizontal" size={23} color={t.ink.primary} /></Pressable>
    </View>
    <View style={styles.actions}>
    <Pressable accessibilityRole="button" accessibilityLabel="Start live" accessibilityHint="Set up a camera preview. You choose when to start broadcasting." onPress={onCreate}
      style={[styles.create, { backgroundColor: t.ink.primary, flex: 1 }]}>
      <LiveIcon size={19} color={t.surface.raised} /><Text style={{ color: t.surface.raised, fontWeight: '700', fontSize: 15 }}>Start live</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Schedule a live stream" onPress={onSchedule || onCreate} style={styles.schedule}><Feather name="calendar" size={18} color={t.ink.primary}/><Text style={{color:t.ink.primary,fontSize:14,fontWeight:'600'}}>Schedule</Text></Pressable>
    </View>
    <View accessibilityRole="tablist" style={[styles.tabs, { borderBottomColor: t.surface.sunken }]}>
      {VIEWS.map(([id, label]) => <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: view === id }} onPress={() => onView(id)}
        style={[styles.tab, { borderBottomColor: view === id ? t.ink.primary : 'transparent' }]}>
        <Text style={{ fontSize: 15, lineHeight: 22, fontWeight: view === id ? '700' : '500', color: view === id ? t.ink.primary : t.ink.secondary }}>{label}</Text>
      </Pressable>)}
    </View>
    <View style={styles.toolbar}>
      <Text numberOfLines={1} style={{ flex: 1, color: t.ink.secondary, fontSize: 13 }}>{summary}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={searchOpen ? 'Close stream search' : 'Search loaded streams'} accessibilityState={{ expanded: searchOpen }} onPress={() => { setSearchOpen(!searchOpen); if (searchOpen) onQuery(''); }} style={styles.iconButton}><Feather name={searchOpen ? 'x' : 'search'} size={19} color={t.ink.primary} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Filters${activeFilters ? `, ${activeFilters} active` : ''}`} onPress={() => setFiltersOpen(true)} style={[styles.inline, { minHeight: 44 }]}><Feather name="sliders" size={17} color={t.ink.primary} /><Text style={{ color: t.ink.primary, fontSize: 13 }}>Filters{activeFilters ? ` (${activeFilters})` : ''}</Text></Pressable>
    </View>
    {searchOpen ? <TextInput value={query} onChangeText={onQuery} accessibilityLabel="Search loaded streams" placeholder="Search these streams" placeholderTextColor={t.ink.muted} maxLength={120} returnKeyType="search" style={[styles.search, { color: t.ink.primary, backgroundColor: t.surface.sunken }]} /> : null}
    <Modal visible={filtersOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setFiltersOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.surface.raised }}>
        <View style={styles.sheetHeader}><Text accessibilityRole="header" style={[styles.sheetTitle, { color: t.ink.primary }]}>Find streams</Text><Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={() => setFiltersOpen(false)} style={styles.iconButton}><Feather name="x" size={22} color={t.ink.primary} /></Pressable></View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          <Text style={{ color: t.ink.secondary, fontWeight: '600', marginVertical: 12 }}>People</Text>
          {DISCOVERY.map(([id, label]) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: filter === id }} onPress={() => onFilter(id)} style={styles.choice}><Text style={{ color: t.ink.primary, fontSize: 16 }}>{label}</Text>{filter === id ? <Feather name="check" size={20} color={t.ink.primary} /> : null}</Pressable>)}
          <Text style={{ color: t.ink.secondary, fontWeight: '600', marginVertical: 12 }}>Topic</Text>
          {LIVE_TOPICS.map(([id, label]) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: topic === id }} onPress={() => onTopic(id)} style={styles.choice}><Text style={{ color: t.ink.primary, fontSize: 16 }}>{label}</Text>{topic === id ? <Feather name="check" size={20} color={t.ink.primary} /> : null}</Pressable>)}
        </ScrollView>
        <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 6 }}>
          <Pressable accessibilityRole="button" onPress={() => { onFilter('for_you'); onTopic('all'); }} style={[styles.choice, { justifyContent: 'center' }]}><Text style={{ color: t.ink.secondary }}>Reset filters</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setFiltersOpen(false)} style={[styles.create, { backgroundColor: t.ink.primary, justifyContent: 'center' }]}><Text style={{ color: t.surface.raised, fontWeight: '700' }}>Show streams</Text></Pressable>
        </View>
      </SafeAreaView>
    </Modal>
    <Modal visible={toolsOpen} transparent animationType="slide" onRequestClose={() => setToolsOpen(false)}>
      <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#0008'}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Live tools" onPress={() => setToolsOpen(false)} style={StyleSheet.absoluteFill}/>
        <SafeAreaView edges={['bottom','left','right']} accessibilityViewIsModal style={{backgroundColor:t.surface.raised,borderTopLeftRadius:24,borderTopRightRadius:24,paddingHorizontal:20,paddingTop:12}}>
          <View style={styles.header}><Text accessibilityRole="header" style={{flex:1,color:t.ink.primary,fontSize:20,fontWeight:'700'}}>Your Live tools</Text><Pressable accessibilityRole="button" accessibilityLabel="Close tools" onPress={() => setToolsOpen(false)} style={styles.iconButton}><Feather name="x" size={22} color={t.ink.primary}/></Pressable></View>
          <Pressable accessibilityRole="button" accessibilityLabel="My clips" onPress={() => {setToolsOpen(false);onClips();}} style={styles.choice}><Text style={{color:t.ink.primary,fontSize:16}}>My clips</Text><Feather name="film" size={20} color={t.ink.primary}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="My streams" onPress={() => {setToolsOpen(false);onFilter('mine');onView('live');}} style={styles.choice}><Text style={{color:t.ink.primary,fontSize:16}}>My streams</Text><Feather name="video" size={20} color={t.ink.primary}/></Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  iconButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  schedule: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 },
  create: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 10 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, paddingHorizontal: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { minHeight: 46, borderRadius: 12, paddingHorizontal: 14, marginBottom: 4 },
  choice: { minHeight: 54, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, minHeight: 60 },
  sheetTitle: { flex: 1, fontSize: 21, fontWeight: '700' },
});
