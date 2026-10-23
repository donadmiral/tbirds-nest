import { themedSheet } from '../theme/useTheme';
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
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

  componentDidCatch(error: Error) {
    analytics.trackError(error, { boundary: 'root', source: 'render' });
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
        <Text style={s.message}>This screen could not load. Please try again.</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Try loading this screen again" style={s.button} onPress={this.reset} activeOpacity={0.85}>
          <Text style={s.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const s = themedSheet((t) => ({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: t.surface.canvas },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: t.ink.primary, marginBottom: 8 },
  message: { fontSize: 14, color: t.ink.secondary, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  button: { backgroundColor: t.ink.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  buttonText: { color: t.ink.inverse, fontSize: 15, fontWeight: '600' },
}));