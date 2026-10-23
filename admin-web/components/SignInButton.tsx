'use client';
import { useFormStatus } from 'react-dom';
export default function SignInButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="mt-1.5 h-[54px] w-full rounded-[14px] text-[16px] font-extrabold transition-opacity duration-150 hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{pending ? 'Signing in…' : 'Sign in'}</button>;
}
