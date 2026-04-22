import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import analytics from '../services/analytics';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error: Error | null };

/**
 * Catches render errors in any subtree so a single screen crash does not
 * blank the whole app. Wrap the root of your app with this.
 *
 * Does NOT catch errors in async code, event handlers, or setTimeout.
 * Those still need try/catch at the callsite.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.log('[ErrorBoundary]', error.message, info.componentStack);
    // Forward to analytics so once a provider is wired up, crashes are
    // captured automatically without any more changes here.
    analytics.trackError(error, {
      boundary: 'root',
      component_stack: info.componentStack ?? null,
    });
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={s.container}>
        <Text style={s.emoji}>⚠️</Text>
        <Text style={s.title}>Something went wrong</Text>
        <Text style={s.message}>{this.state.error?.message ?? 'Unknown error'}</Text>
        <TouchableOpacity style={s.button} onPress={this.reset} activeOpacity={0.85}>
          <Text style={s.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#FFFFFF' },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  message: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  button: { backgroundColor: '#2563EB', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});