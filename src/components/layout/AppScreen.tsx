import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type AppScreenProps = {
  children: React.ReactNode;
  scroll?: boolean;
  backgroundColor?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  keyboardOffset?: number;
};

export default function AppScreen({
  children,
  scroll = false,
  backgroundColor = '#F8FAFC',
  contentContainerStyle,
  style,
  keyboardOffset = 0,
}: AppScreenProps) {
  const insets = useSafeAreaInsets();

  const inner = scroll ? (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingTop: insets.top + 12,
          paddingBottom: Math.max(insets.bottom + 24, 32),
        },
        contentContainerStyle,
      ]}
      style={[styles.fill, { backgroundColor }]}
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.content,
        {
          paddingTop: insets.top + 12,
          paddingBottom: Math.max(insets.bottom + 16, 20),
          backgroundColor,
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor }]}
      edges={['left', 'right', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardOffset}
      >
        {inner}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
  },
});