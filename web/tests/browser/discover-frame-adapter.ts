/** Synthetic session only. No credentials or hosted requests. */
type Session = { user: { id: string }; access_token: string };
const token = (owner: string, session: string) => `${owner}.${btoa(JSON.stringify({ session_id: session }))}.signature`;
const listeners = new Set<(event: string, session: Session) => void>();
let sessionState: Session = { user: { id: 'fixture-a' }, access_token: token('fixture-a', 'session-a') };
const client = {
  auth: {
    getSession: async () => ({ data: { session: sessionState }, error: null }),
    onAuthStateChange(fn: (event: string, session: Session) => void) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
  },
  from() { return { insert: async () => ({ error: null }) }; },
  rpc: async () => ({ data: null, error: null }),
};
export const createClient = () => client;
export const service = {
  session(owner: string, session: string) { sessionState = { user: { id: owner }, access_token: token(owner, session) }; listeners.forEach(fn => fn('SIGNED_IN', sessionState)); },
};
