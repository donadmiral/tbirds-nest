import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from './SafeArea';
import { useTheme } from '../theme/useTheme';
import { useThemeStore, type ThemeMode } from '../stores/themeStore';

const choices: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: 'Follow my phone' }, { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dim' }, { mode: 'lightsOut', label: 'Lights out' },
];
export default function AppearanceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const mode = useThemeStore(state => state.mode);
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  if (!visible) return null;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <Pressable testID="appearance-backdrop" accessibilityRole="button" accessibilityLabel="Dismiss appearance" onPress={onClose} style={StyleSheet.absoluteFillObject} />
      <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={{ backgroundColor: t.surface.canvas, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: Math.max(insets.bottom, 12), maxHeight: Math.max(120, height - insets.top - 24) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text accessibilityRole="header" style={{ color: t.ink.primary, fontSize: 20, fontWeight: '700' }}>Appearance</Text>
          <Pressable testID="appearance-close" accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} style={{ minWidth: 64, minHeight: 48, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: t.ink.primary }}>Cancel</Text></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
          {choices.map(choice => <Pressable key={choice.mode} testID={'appearance-mode-' + choice.mode} accessibilityRole="radio" accessibilityLabel={choice.label} accessibilityState={{ checked: mode === choice.mode }} onPress={() => { void useThemeStore.getState().setMode(choice.mode); onClose(); }} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: t.ink.primary, fontSize: 16 }}>{choice.label}</Text><Text accessibilityElementsHidden importantForAccessibility="no" style={{ color: t.ink.primary }}>{mode === choice.mode ? '✓' : ''}</Text>
          </Pressable>)}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
