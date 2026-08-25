/**
 * KeyboardSafe — the app-wide keyboard avoidance wrapper.
 * Wrap any screen or form so the keyboard never covers inputs or the
 * controls beneath them. Part of the responsive, keyboard-safe,
 * safe-area-aware quality gate: every input-bearing surface ships
 * wrapped, no exceptions.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';

export default function KeyboardSafe({ children, offset = 0, style }: {
  children: React.ReactNode;
  offset?: number;
  style?: any;
}) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={offset}
      style={[{ flex: 1 }, style]}
    >
      {children}
    </KeyboardAvoidingView>
  );
}