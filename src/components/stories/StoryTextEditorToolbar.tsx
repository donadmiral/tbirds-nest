import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

type Props = {
  topInset: number;
  compact?: boolean;
  alignment: 'left' | 'center' | 'right';
  background: boolean;
  onClose: () => void;
  onAlign: () => void;
  onBackground: () => void;
  onDecreaseSize: () => void;
  onIncreaseSize: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onSave: () => void;
};

/** Keep dismissal and saving reachable even on small screens or large text. */
export default function StoryTextEditorToolbar(props: Props) {
  return <View style={{ paddingTop: Math.max(props.topInset, 12) }}>
    <View style={s.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel text editing" onPress={props.onClose} style={[s.button, { width: 65, backgroundColor: 'transparent' }]}>
        <Text style={{ color: '#FFFFFF', fontSize: 15 }}>Cancel</Text>
      </TouchableOpacity>
      <Text style={s.title}>{props.compact ? '' : 'Edit text'}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save text sticker" onPress={props.onSave} style={s.done}>
        <Text style={s.doneText}>Done</Text>
      </TouchableOpacity>
    </View>
    {!props.compact ? <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={s.tools}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Text alignment: ${props.alignment}`} onPress={props.onAlign} style={s.button}><Feather name={`align-${props.alignment}`} size={20} color="#FFFFFF" /></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Text background" accessibilityState={{ selected: props.background }} onPress={props.onBackground} style={[s.button, props.background && s.selected]}><Feather name="square" size={20} color={props.background ? '#0B1E3D' : '#FFFFFF'} /></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Decrease text size" onPress={props.onDecreaseSize} style={s.button}><Text style={s.size}>A−</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Increase text size" onPress={props.onIncreaseSize} style={s.button}><Text style={s.size}>A+</Text></TouchableOpacity>
      {props.onDuplicate && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Duplicate text sticker" onPress={props.onDuplicate} style={s.button}><Feather name="copy" size={20} color="#FFFFFF" /></TouchableOpacity>}
      {props.onDelete && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete text sticker" onPress={props.onDelete} style={s.button}><Feather name="trash-2" size={20} color="#FF8A84" /></TouchableOpacity>}
    </ScrollView> : null}
  </View>;
}
const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, gap: 12 },
  title: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  button: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: '#FFFFFF' },
  done: { minWidth: 60, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 22, backgroundColor: '#E8D3B6' },
  doneText: { color: '#0B1E3D', fontSize: 15, fontWeight: '800' },
  tools: { paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  size: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
