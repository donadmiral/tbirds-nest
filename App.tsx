import React, { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FlashMessage from 'react-native-flash-message';

import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useAuthStore } from './src/stores/authStore';
import { feedSnapshots, warmFeedSnapshots } from './src/services/feedSnapshot';
import { navigationScope, subscribeNavigationScope } from './src/lib/navigationCache';
import { startupSnapshots, waitForStartupSnapshots } from './src/services/startupSnapshots';
import './src/services/startupContentSnapshots';
import SplashLoader from './src/components/SplashLoader';
import { useFonts } from 'expo-font';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { Caveat_600SemiBold } from '@expo-google-fonts/caveat';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono';

/**
 * Single QueryClient for the whole app. Defaults tuned for a mobile social
 * app where data changes frequently but we do not want to hammer the API
 * on every screen focus.
 *
 * staleTime 30s means queries served from cache within 30 seconds of the
 * last fetch are considered fresh and will not re-fetch on refocus.
 *
 * gcTime 5min keeps unused query data in memory for 5 minutes so tab
 * switches feel instant.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

// The client outlives individual screens (and can outlive an App render). Clear
// it synchronously on every real session boundary, including A→B→A changes.
// Cancelling first prevents an old query from publishing after the clear.
subscribeNavigationScope(() => {
  void queryClient.cancelQueries().catch(() => {});
  queryClient.clear();
  feedSnapshots.setAccount(null);
  feedSnapshots.setAccount(useAuthStore.getState().session?.user.id ?? null);
});

function syncStartupAccount() {
  const state = useAuthStore.getState();
  // A not-yet-read session is not a sign-out. Keep the last owner's encrypted
  // disk copy until authentication establishes the actual next account.
  if (!state.initialized && !state.session) return;
  void startupSnapshots.setAccount(state.session?.user.id ?? null, navigationScope());
}
useAuthStore.subscribe(syncStartupAccount);
syncStartupAccount();

export default function App() {
  const initialize = useAuthStore((state) => state.initialize);
  const session = useAuthStore((state) => state.session);
  const initialized = useAuthStore((state) => state.initialized);
  const scope = navigationScope();
  const [readyScope, setReadyScope] = useState<string | null | undefined>(undefined);
  useFonts({
    SpaceGrotesk_500Medium, SpaceGrotesk_700Bold, Caveat_600SemiBold,
    ArchivoBlack_400Regular, SpaceMono_400Regular,
  });

  useEffect(() => {
    feedSnapshots.setAccount(useAuthStore.getState().session?.user.id ?? null);
    const stop = useAuthStore.subscribe(state => {
      feedSnapshots.setAccount(state.session?.user.id ?? null);
    });
    initialize();
    return stop;
  }, [initialize]);

  useEffect(() => {
    if (!initialized) return;
    let active = true;
    const owner = session?.user.id ?? null;
    const local = startupSnapshots.setAccount(owner, scope).then(() => owner
      ? Promise.all([startupSnapshots.hydrate(owner), warmFeedSnapshots(owner)]) : undefined);
    void waitForStartupSnapshots(local).then(() => { if (active) setReadyScope(scope); });
    return () => { active = false; };
  }, [initialized, scope, session?.user.id]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
            {initialized && readyScope === scope ? <AppNavigator /> : <SplashLoader />}
            <FlashMessage position="top" floating />
          </SafeAreaProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
