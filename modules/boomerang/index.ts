// modules/boomerang/index.ts
// A real boomerang: the clip written forward then backward into one file, so
// it bounces everywhere it plays with no player tricks. Optional on purpose:
// a client built without the module gets a clean error and the caller keeps
// the straight clip.
import { requireOptionalNativeModule } from 'expo-modules-core';

const Native: any = requireOptionalNativeModule('Boomerang');

export const boomerangAvailable = !!Native;

export async function makeBoomerang(inputUri: string, outputUri: string, loops = 1): Promise<string> {
  if (!Native) throw new Error('Boomerang is not in this build');
  return Native.make(inputUri, outputUri, loops);
}