// src/utils/captureBridge.ts
// Hands a FunCamera capture back to the screen that opened it. Feed lives as
// FeedMain inside the Feed tab inside Main, so route params from the root stack
// never reach it. The opener pops back with goBack and reads this on focus.
export type BridgedCapture = { uri: string; type: 'image' | 'video'; width?: number; height?: number; filterId?: string | null };
const pending: Record<string, BridgedCapture | null> = {};
export function setPendingCapture(target: string, media: BridgedCapture) { pending[target] = media; }
export function takePendingCapture(target: string): BridgedCapture | null { const m = pending[target] || null; pending[target] = null; return m; }