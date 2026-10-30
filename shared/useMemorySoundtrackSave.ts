import { readSoundtrack, type SoundtrackSelection } from './soundtrack';
import type { MemoryPlaybackHooks } from './useMemoryPlayback';

export const BOOK_SOUNDTRACK_TIMEOUT_MS = 20000;
type Session = { user: { id: string }; access_token: string };
type Query = PromiseLike<{ data: unknown; error: unknown }> & {
  setHeader(name: string, value: string): Query;
  abortSignal(signal: AbortSignal): Query;
};
type Client = {
  auth: {
    getSession(): PromiseLike<{ data: { session: Session | null }; error: unknown }>;
    onAuthStateChange(callback: (event: string, session: Session | null) => void): { data: { subscription: { unsubscribe(): void } } };
  };
  rpc(name: string, args: Record<string, unknown>): Query;
};
type Visit = { client: Client; owner: string | null; book: string | null; route: string; revision: number; valid: boolean };
type Draft = { selection: SoundtrackSelection | null; retry: 'save' | 'check' };
type State = { visit: Visit | null; draft: Draft | null; busy: boolean; error: string; notice: string };
type Options = { client: Client; owner: string | null; book: string | null; route: string; canEdit: boolean; onConfirmed(book: string, selection: SoundtrackSelection | null): void };
const empty = (): State => ({ visit: null, draft: null, busy: false, error: '', notice: '' });

async function interruptible<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error('The soundtrack request was interrupted.');
  let abort: () => void = () => {};
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      abort = () => reject(new Error('The soundtrack request was interrupted.'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}

/** Both clients use their own React installation. Saves pin their owner JWT,
 * confirm the actual book row and never call a stale full-book reload closure. */
export function createMemorySoundtrackSaveHook({ useEffect, useRef, useState }: MemoryPlaybackHooks) {
  return function useMemorySoundtrackSave(options: Options) {
    const { client, owner, book, route, canEdit, onConfirmed } = options;
    const [revision, setRevision] = useState(0);
    const visitRef = useRef<Visit>({ client, owner, book, route, revision, valid: true });
    if (visitRef.current.client !== client || visitRef.current.owner !== owner || visitRef.current.book !== book
      || visitRef.current.route !== route || visitRef.current.revision !== revision) {
      visitRef.current.valid = false;
      visitRef.current = { client, owner, book, route, revision, valid: true };
    }
    const visit = visitRef.current;
    const callback = useRef(onConfirmed); callback.current = onConfirmed;
    const editable = useRef(canEdit); editable.current = canEdit;
    const pending = useRef<{ visit: Visit; draft: Draft } | null>(null);
    const operation = useRef<{ visit: Visit; controller: AbortController } | null>(null);
    const [state, setState] = useState<State>(empty);
    const current = () => visit.valid && visitRef.current === visit;

    useEffect(() => {
      let lastOwner: string | null | undefined;
      const watcher = client.auth.onAuthStateChange((event, session) => {
        const next = session?.user.id ?? null;
        const changed = event === 'SIGNED_OUT' || (lastOwner === undefined ? !!visitRef.current.owner && visitRef.current.owner !== next : lastOwner !== next);
        lastOwner = next;
        if (changed) {
          visitRef.current.valid = false; operation.current?.controller.abort();
          pending.current = null; setRevision(value => value + 1);
        }
      });
      return () => { watcher.data.subscription.unsubscribe(); visitRef.current.valid = false; operation.current?.controller.abort(); };
    }, [client]);
    useEffect(() => {
      visit.valid = true;
      return () => { visit.valid = false; if (operation.current?.visit === visit) operation.current.controller.abort(); };
    }, [visit]);

    const run = async (selection: SoundtrackSelection | null, mode: 'save' | 'check') => {
      if (!current() || !owner || !book || !editable.current || operation.current?.visit === visit) return;
      const checked = selection === null ? null : readSoundtrack(selection);
      if (selection !== null && !checked) { setState({ visit, draft: pending.current?.visit === visit ? pending.current.draft : null, busy: false, error: 'Choose the book soundtrack again before saving.', notice: '' }); return; }
      // An uncertain write must be read before another selection can replace it.
      if (mode === 'save' && pending.current?.visit === visit && pending.current.draft.retry === 'check') return;
      const controller = new AbortController(), token = { visit, controller };
      operation.current = token;
      const draft: Draft = { selection: checked, retry: mode };
      pending.current = { visit, draft };
      setState({ visit, draft, busy: true, error: '', notice: '' });
      let uncertain = mode === 'check';
      const deadline = setTimeout(() => controller.abort(), BOOK_SOUNDTRACK_TIMEOUT_MS);
      const ensure = () => { if (!current() || controller.signal.aborted) throw new Error('The soundtrack request was interrupted.'); };
      try {
        const { data, error } = await interruptible(client.auth.getSession(), controller.signal);
        ensure();
        if (error || data.session?.user.id !== owner || !data.session.access_token) throw new Error('Return to the account that owns this book.');
        const authorization = `Bearer ${data.session.access_token}`;
        if (mode === 'save') {
          uncertain = true;
          const result = await interruptible(client.rpc('save_memory_book_soundtrack', { p_album: book, p_soundtrack: checked }).setHeader('Authorization', authorization).abortSignal(controller.signal), controller.signal);
          ensure();
          // A returned error can be a lost/proxy response after the write committed.
          // Only a read of this book can establish the saved value before retrying.
          if (result.error) throw new Error('The book soundtrack save could not be confirmed.');
        }
        const result = await interruptible(client.rpc('get_memory_book', { p_album: book }).setHeader('Authorization', authorization).abortSignal(controller.signal), controller.signal);
        ensure();
        const row = result.data as { id?: unknown; is_owner?: unknown; user_id?: unknown; soundtrack?: unknown } | null;
        if (result.error || !row || row.id !== book || row.is_owner !== true || !('soundtrack' in row) || (row.user_id != null && row.user_id !== owner)) throw new Error('The saved book soundtrack could not be checked.');
        const actual = row.soundtrack == null ? null : readSoundtrack(row.soundtrack);
        if (row.soundtrack != null && !actual) throw new Error('The saved book soundtrack could not be checked.');
        callback.current(book, actual);
        if (JSON.stringify(actual) === JSON.stringify(checked)) {
          pending.current = null;
          setState({ visit, draft: null, busy: false, error: '', notice: actual ? 'Book soundtrack saved.' : 'Book soundtrack removed.' });
        } else {
          const retained: Draft = { selection: checked, retry: 'save' }; pending.current = { visit, draft: retained };
          setState({ visit, draft: retained, busy: false, error: 'The book currently has a different soundtrack. Your selection is kept. Retry save or choose another sound.', notice: '' });
        }
      } catch (failure) {
        if (current()) {
          const retained: Draft = { selection: checked, retry: uncertain ? 'check' : 'save' };
          pending.current = { visit, draft: retained };
          setState({ visit, draft: retained, busy: false, error: retained.retry === 'check'
            ? 'The soundtrack save could not be confirmed. Your selection is kept. Check saved music before making another change.'
            : failure instanceof Error ? failure.message : 'The book soundtrack could not save. Your selection is kept. Retry.', notice: '' });
        }
      } finally {
        clearTimeout(deadline);
        if (operation.current === token) operation.current = null;
      }
    };
    const shown = state.visit === visit ? state : empty();
    return {
      ...shown, needsConfirmation: shown.draft?.retry === 'check',
      save: (selection: SoundtrackSelection | null) => run(selection, 'save'),
      retry: () => { const request = pending.current; return request?.visit === visit ? run(request.draft.selection, request.draft.retry) : Promise.resolve(); },
    };
  };
}
