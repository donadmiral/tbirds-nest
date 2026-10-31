/** Disposable QA route. Never registered in the application source. */
import React, { useState } from 'react';
import { Keyboard, Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { fixtureRuntime } from '../fixture-runtime.cjs';
const manifest = require('./manifest.json');

export default function AuditLauncherScreen({ navigation }: { navigation: any }) {
  const [caseId, setCaseId] = useState('');
  const [issue, setIssue] = useState('');
  const open = () => {
    const selected = manifest.cases.find((item: any) => item.id === caseId);
    if (!selected) { setIssue('Unknown audit case'); return; }
    Keyboard.dismiss();
    fixtureRuntime().selectAuditCase(selected.id, selected.fixtureScenario);
    // This changes navigation state only. Production auth/call/account providers
    // remain mounted. Entry smoke is reported separately from user-path journeys.
    navigation.dispatch(CommonActions.reset(selected.state));
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#fff', padding: 24 }}>
    <Pressable onPress={Keyboard.dismiss} accessibilityRole="button" accessibilityLabel="Native audit launcher">
      <Text style={{ fontSize: 25, color: '#111', marginVertical: 24 }}>Native audit launcher</Text>
    </Pressable>
    <Text style={{ color: '#111' }}>Disposable synthetic account. Each case reports its own result.</Text>
    <TextInput testID="native-audit-case-input" accessibilityLabel="Audit case identifier"
      autoCapitalize="none" autoCorrect={false} value={caseId} onChangeText={setCaseId}
      style={{ color: '#111', borderWidth: 1, padding: 14, marginVertical: 24 }} />
    <Pressable testID="native-audit-open-case" accessibilityRole="button" accessibilityLabel="Open audit case"
      onPress={open} style={{ padding: 16, backgroundColor: '#0b1e3d' }}>
      <Text style={{ color: '#fff' }}>Open audit case</Text>
    </Pressable>
    <View><Text style={{ color: '#b00020' }}>{issue}</Text></View>
  </SafeAreaView>;
}
