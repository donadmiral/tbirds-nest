/** Synthetic Auth boundary only. Production viewers, transports and HLS loader remain real. */
import type { ReactNode } from 'react';
export const userId = '10000000-0000-4000-8000-000000000008';
let session: { user: { id: string }; access_token: string } | null = { user: { id: userId }, access_token: 'synthetic-private-bearer' };
const listeners = new Set<(event: string, value: typeof session) => void>();
export const createClient = () => ({ auth: {
  getSession: async () => ({ data: { session }, error: null }),
  onAuthStateChange(fn: (event: string, value: typeof session) => void) {
    listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
  },
} });
export function changeAccount() { session = null; listeners.forEach(fn => fn('SIGNED_OUT', session)); }
export function PrivateCameraGuard(): ReactNode { throw Error('Camera analysis is outside this media test'); }
