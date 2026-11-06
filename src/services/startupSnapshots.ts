import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createChunkedSnapshotStorage, createStartupSnapshotRegistry, type SnapshotOptions } from './startupSnapshotCore';

// Private launch data never falls back to plaintext storage. Unsupported or
// locked secure storage behaves as a cache miss and leaves live requests alone.
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const secureStorage = createChunkedSnapshotStorage({
  getItem: key => SecureStore.getItemAsync(key, secureOptions),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
  removeItem: key => SecureStore.deleteItemAsync(key, secureOptions),
});

export const startupSnapshots = createStartupSnapshotRegistry({
  secure: secureStorage, public: AsyncStorage, metadata: AsyncStorage,
});
export function createStartupSnapshot<T>(id: string, options: SnapshotOptions<T>) {
  return startupSnapshots.create(id, options);
}

/** Local data gets one short launch budget. A slow disk may still hydrate
 * subscribed screens afterwards. Network work never belongs in this promise. */
export async function waitForStartupSnapshots(work: Promise<unknown>, milliseconds = 350): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work.catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, milliseconds); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
