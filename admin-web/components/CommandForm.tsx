'use client';
import { useRef, useState, type ComponentProps } from 'react';

type Props = Omit<ComponentProps<'form'>, 'action' | 'onSubmit'> & {
  action: (data: FormData) => unknown | Promise<unknown>;
  scope: string;
};
export default function CommandForm({ action, scope, children, ...props }: Props) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  return <form {...props} aria-busy={busy} onSubmit={async event => {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) data.set(submitter.name, submitter.value);
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const pairs = [...data.entries()].filter(([name]) => name !== 'command_key' && !/password|secret|token/i.test(name)).sort(([a], [b]) => a.localeCompare(b));
      if (pairs.some(([, value]) => typeof value !== 'string')) throw new Error('File uploads are not supported by this form.');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([window.location.pathname, scope, pairs])));
      const storageKey = 'pc-admin-command-' + [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
      let key: string;
      try {
        key = localStorage.getItem(storageKey) || crypto.randomUUID();
        localStorage.setItem(storageKey, key);
        if (localStorage.getItem(storageKey) !== key) throw new Error();
      } catch { throw new Error('Allow browser storage before submitting this change.'); }
      data.set('command_key', key);
      const result = await action(data);
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        throw new Error('error' in result && typeof result.error === 'string' ? result.error : 'The change was not confirmed. Retry the same details.');
      }
      if (result && typeof result === 'object' && 'message' in result && typeof result.message === 'string') setMessage(result.message);
      if (localStorage.getItem(storageKey) === key) localStorage.removeItem(storageKey);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The change was not confirmed. Retry the same details.');
    } finally { pending.current = false; setBusy(false); }
  }}>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>{children}</fieldset>
    {message && <p role="status" style={{ fontSize: 13 }}>{message}</p>}
    {error && <p role="alert" style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</p>}
  </form>;
}
