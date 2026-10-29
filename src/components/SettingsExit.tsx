import React from 'react';
import { TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { exitSettings } from '../navigation/settingsNavigation';

export default function SettingsExit({ navigation }: { navigation: Parameters<typeof exitSettings>[0] }) {
  const { t } = useTheme();
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Exit settings to your profile" onPress={() => exitSettings(navigation)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Feather name="x" size={21} color={t.ink.primary} /></TouchableOpacity>;
}
