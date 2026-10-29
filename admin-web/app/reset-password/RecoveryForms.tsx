'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { requestPasswordReset, updateRecoveryPassword, verifyRecoveryAuthenticator } from './actions';

const inputStyle = { background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--txt)' };
const inputClass = 'w-full rounded-xl px-4 py-3 text-[15px]';
const buttonClass = 'w-full rounded-xl px-4 py-3 font-bold disabled:opacity-50';
const buttonStyle = { background: 'var(--accent)', color: 'var(--accent-ink)' };
type Result = { success: boolean; error?: string; message?: string };

export default function RecoveryForms({ mode, factors = [] }: { mode: 'request' | 'mfa' | 'password'; factors?: { id: string; name: string }[] }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    const form = event.currentTarget;
    pending.current = true; setBusy(true); setError('');
    try {
      const data = new FormData(form);
      const result: Result = await (mode === 'request' ? requestPasswordReset(data) : mode === 'mfa' ? verifyRecoveryAuthenticator(data) : updateRecoveryPassword(data));
      if (!result.success) { setError(result.error || 'The request could not be completed. Please try again.'); return; }
      form.reset();
      if (mode === 'mfa') router.refresh();
      else setMessage(result.message || 'Request completed.');
    } catch { setError('The request could not be completed. Check your connection and try again.'); }
    finally { pending.current = false; setBusy(false); }
  }
  if (message) return <div><p role="status" className="text-sm">{message}</p><Link href="/" className="mt-5 inline-block font-bold underline">Back to sign in</Link></div>;
  return <form onSubmit={submit} aria-busy={busy} className="flex flex-col gap-3">
    <fieldset disabled={busy} className="flex min-w-0 flex-col gap-3 border-0 p-0">
      {mode === 'request' ? <><label htmlFor="recovery-email">Staff email</label><input id="recovery-email" name="email" type="email" autoComplete="username" maxLength={254} required className={inputClass} style={inputStyle} /></>
        : mode === 'mfa' ? <><label htmlFor="recovery-factor">Existing authenticator</label><select id="recovery-factor" name="factorId" className={inputClass} style={inputStyle}>{factors.map(factor => <option key={factor.id} value={factor.id}>{factor.name}</option>)}</select><label htmlFor="recovery-code">Six-digit code</label><input id="recovery-code" name="code" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required className={inputClass} style={inputStyle} /></>
          : <><label htmlFor="recovery-password">New password</label><input id="recovery-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required className={inputClass} style={inputStyle} /><label htmlFor="recovery-confirmation">Confirm new password</label><input id="recovery-confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={72} required className={inputClass} style={inputStyle} /><p className="text-xs">Use a unique passphrase with at least 12 characters.</p></>}
      <button type="submit" disabled={busy} className={buttonClass} style={buttonStyle}>{busy ? 'Please wait…' : mode === 'request' ? 'Send reset link' : mode === 'mfa' ? 'Verify authenticator' : 'Update password'}</button>
    </fieldset>
    {error && <p role="alert" className="text-sm" style={{ color: 'var(--bad)' }}>{error}</p>}
  </form>;
}
