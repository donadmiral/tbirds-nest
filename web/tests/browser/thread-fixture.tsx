/** Actual MessagesApp with synthetic authenticated records. Never an app route. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessagesApp } from '../../components/MessagesApp';
import { ThemeProvider } from '../../components/ThemeProvider';
import { createClient, fixture, OWNER, CREATOR } from './social-backend';
import type { Msg } from '../../lib/messages';

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const make = (n: number): Msg => ({ id: id(n), conversation_id: 'conversation-fixture', sender_id: n % 2 ? OWNER : CREATOR,
  receiver_id: n % 2 ? CREATOR : OWNER, text: `Retained message ${n}. ${'A changing length keeps real geometry useful. '.repeat(n % 5 + 1)}`,
  media_url: null, media_type: null, reply_to_id: null, created_at: new Date(1767225600000 + n * 60_000).toISOString() });
const messages = Array.from({ length: 420 }, (_, n) => make(n + 1)), denied = new Set<string>();
const reads: { ids: string[] | null; older: number | null; limit: number; pinned: boolean }[] = [];
const callbacks = new Set<{ event: string; callback: (payload: unknown) => unknown }>();
const client = createClient(), from = client.from.bind(client), channel = client.channel.bind(client);
client.from = ((table: string) => {
  const original = from(table);
  if (table !== 'messages') return original;
  let ids: string[] | null = null, older: number | null = null, maximum = Infinity, conversation = '', single = false, token = '', signal: AbortSignal | undefined;
  const query = {
    select() { return query; }, eq(key: string, value: string) { if (key === 'conversation_id') conversation = value; if (key === 'id') ids = [value]; return query; },
    in(key: string, value: string[]) { if (key === 'id') ids = value; return query; },
    or(value: string) { const cursor = value.match(/id\.lt\.([0-9a-f-]+)/i)?.[1]; if (cursor) older = Number(cursor.split('-').at(-1)); return query; },
    order() { return query; }, limit(value: number) { maximum = value; return query; },
    setHeader(name: string, value: string) { if (name.toLowerCase() === 'authorization') token = value; return query; },
    abortSignal(value: AbortSignal) { signal = value; return query; },
    maybeSingle() { single = true; return query; },
    then(yes: (value: unknown) => unknown, no?: (reason: unknown) => unknown) {
      reads.push({ ids: ids && [...ids], older, limit: Number.isFinite(maximum) ? maximum : -1, pinned: token === 'Bearer synthetic-only-no-live-access' });
      const rows = fixture.owner() === OWNER && (!conversation || conversation === 'conversation-fixture')
        ? messages.filter(row => !denied.has(row.id) && (!ids || ids.includes(row.id)) && (older === null || Number(row.id.split('-').at(-1)) < older))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, maximum).map(row => ({ ...row })) : [];
      return Promise.resolve(signal?.aborted ? { data: null, error: { message: 'Aborted' } } : { data: single ? rows[0] ?? null : rows, error: null }).then(yes, no);
    },
  };
  return query;
}) as typeof client.from;
client.channel = ((name: string) => {
  if (!name.startsWith('web_messages_')) return channel(name);
  const owned: { event: string; callback: (payload: unknown) => unknown }[] = [];
  const result = {
    on(_kind: string, filter: { event: string }, callback: (payload: unknown) => unknown) { const entry = { event: filter.event, callback }; owned.push(entry); callbacks.add(entry); return result; },
    subscribe() { return result; },
    unsubscribe() { owned.forEach(entry => callbacks.delete(entry)); return Promise.resolve(); },
  }; return result;
}) as typeof client.channel;
client.removeChannel = (async (value: { unsubscribe: () => Promise<unknown> }) => { await value.unsubscribe(); return 'ok'; }) as typeof client.removeChannel;
const controls = {
  reads,
  deny(values: number[]) { values.forEach(value => denied.add(id(value))); },
  async insert(n: number) { const row = make(n); messages.push(row); for (const entry of [...callbacks]) if (entry.event === 'INSERT') await entry.callback({ new: row }); },
  leave() { window.dispatchEvent(new CustomEvent('thread-fixture-route', { detail: false })); },
  return() { window.dispatchEvent(new CustomEvent('thread-fixture-route', { detail: true })); },
  readReceipts: () => fixture.receipt.filter(row => row.rpc === 'mark_conversation_read').length,
};
declare global { interface Window { __threadFixture: typeof controls } }
window.__threadFixture = controls;
function Fixture() {
  const [shown, setShown] = useState(true);
  useEffect(() => { const update = (event: Event) => setShown((event as CustomEvent<boolean>).detail); window.addEventListener('thread-fixture-route', update); return () => window.removeEventListener('thread-fixture-route', update); }, []);
  return <ThemeProvider><main style={{ padding: 24 }}>{shown ? <MessagesApp /> : <p data-away="true">Another route</p>}</main></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
