import { TAB_BAR_CLEARANCE } from '../../constants/layout';
/**
 * ArticleReaderScreen - Twitter long-form reading view.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

const W = Dimensions.get('window').width;

export default function ArticleReaderScreen({ route, navigation }: any) {
  const a = route.params?.article || {};
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.bar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color="#0A0A0A" />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE + 74 }}>
        {!!a.cover && <Image source={{ uri: a.cover }} style={s.cover} />}
        <View style={s.body}>
          <Text style={s.title}>{a.title}</Text>
          <View style={s.metaRow}>
            <Text style={s.meta}>{a.author || 'Member'}</Text>
            {!!a.readMinutes && <Text style={s.meta}>  ·  {a.readMinutes} min read</Text>}
          </View>
          <Text style={s.text}>{a.body}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  bar: { paddingHorizontal: 12, paddingVertical: 8 },
  cover: { width: W, height: W * 0.52, backgroundColor: '#EFEFF4' },
  body: { paddingHorizontal: 20, paddingTop: 18 },
  title: { fontSize: 30, fontWeight: '800', color: '#0A0A0A', letterSpacing: -0.8, lineHeight: 36 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 20 },
  meta: { fontSize: 14, color: '#6B7280' },
  text: { fontSize: 17.5, lineHeight: 28, color: '#111827' },
});