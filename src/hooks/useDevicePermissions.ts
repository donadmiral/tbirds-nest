import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { PermissionResponse } from 'expo-modules-core';
import { ensureCameraPermission, ensureMicrophonePermission, getCameraPermission, getMicrophonePermission } from '../services/devicePermissions';

function usePermission(read: () => Promise<PermissionResponse>, ensure: () => Promise<PermissionResponse>) {
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++generation.current;
    const value = await read();
    if (mounted.current && run === generation.current) setPermission(value);
    return value;
  }, [read]);
  const request = useCallback(async () => {
    generation.current++;
    await ensure();
    // A prompt can send the app through inactive/active. Read once it finishes,
    // and never let an older mount/resume read overwrite that confirmed grant.
    return refresh();
  }, [ensure, refresh]);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => undefined);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh().catch(() => undefined); });
    return () => { mounted.current = false; generation.current++; subscription.remove(); };
  }, [refresh]);
  return [permission, request, refresh] as const;
}

export const useCameraPermissions = () => usePermission(getCameraPermission, ensureCameraPermission);
export const useMicrophonePermissions = () => usePermission(getMicrophonePermission, ensureMicrophonePermission);
