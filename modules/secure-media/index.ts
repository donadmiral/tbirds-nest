import { requireOptionalNativeModule } from 'expo-modules-core';
const module = requireOptionalNativeModule<{ transform(input: string, output: string, key: string, decrypt: boolean): Promise<number> }>('SecureMedia');
export const secureMediaAvailable = !!module;
let pending: Promise<unknown> = Promise.resolve();
export function transformMediaFile(input: string, output: string, key: string, decrypt: boolean): Promise<number> {
  if (!module) throw new Error('Encrypted offline media requires an updated app build.');
  const work = pending.catch(() => {}).then(() => module.transform(input, output, key, decrypt));
  pending = work.catch(() => {});
  return work;
}
