// Transport outcomes contain no URLs, tokens, or account data. Keeping this
// separate avoids a Supabase -> outbox -> Supabase initialization cycle.
type Listener = (reachable: boolean) => void;
const listeners = new Set<Listener>();
export function reportNetworkActivity(reachable: boolean) {
  listeners.forEach(listener => { try { listener(reachable); } catch { /* Observers cannot change the request result. */ } });
}
export function subscribeNetworkActivity(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
