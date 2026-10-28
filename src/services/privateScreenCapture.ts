import * as Capture from "expo-screen-capture";
import { Platform } from "react-native";
let holders = 0;
let queue = Promise.resolve();
const key = "platinum-private-view";
export async function protectPrivateScreen(): Promise<() => void> {
  let acquired = false;
  const work = queue.then(async () => {
    if (holders === 0) {
      await Capture.preventScreenCaptureAsync(key);
      try {
        if (Platform.OS === "ios")
          await Capture.enableAppSwitcherProtectionAsync();
      } catch (error) {
        await Capture.allowScreenCaptureAsync(key).catch(() => {});
        throw error;
      }
    }
    holders++;
    acquired = true;
  });
  queue = work.catch(() => {});
  await work;
  return () => {
    if (!acquired) return;
    acquired = false;
    queue = queue
      .then(async () => {
        holders = Math.max(0, holders - 1);
        if (holders === 0) {
          await Capture.allowScreenCaptureAsync(key);
          if (Platform.OS === "ios")
            await Capture.disableAppSwitcherProtectionAsync().catch(() => {});
        }
      })
      .catch(() => {});
  };
}
