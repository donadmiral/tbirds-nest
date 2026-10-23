import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { signIn } from '@/lib/actions';
import { signInErrors } from '@/lib/adminRecoveryPolicy';
import AuthPanel from '@/components/AuthPanel';
import SignInButton from '@/components/SignInButton';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAdmin()) redirect('/dashboard');
  const { error } = await searchParams;
  const message = error ? (typeof error === 'string' && Object.hasOwn(signInErrors, error) ? signInErrors[error] : signInErrors.credentials) : '';
  return <AuthPanel>
    {message && <p role="alert" className="mb-3 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold" style={{ background: 'rgba(var(--bad-rgb),0.10)', color: 'var(--bad)', border: '1px solid var(--bad)' }}>{message}</p>}
    <form action={signIn} className="flex flex-col gap-3">
      <label className="sr-only" htmlFor="staff-email">Staff email</label>
      <input id="staff-email" name="email" type="email" required placeholder="Staff email" autoComplete="username"
        className="h-[54px] w-full rounded-[14px] px-4 text-[15px] outline-none transition-colors duration-150 focus:border-[#0B1E3D]"
        style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--txt)' }} />
      <label className="sr-only" htmlFor="staff-password">Password</label>
      <input id="staff-password" name="password" type="password" required placeholder="Password" autoComplete="current-password"
        className="h-[54px] w-full rounded-[14px] px-4 text-[15px] outline-none transition-colors duration-150 focus:border-[#0B1E3D]"
        style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--txt)' }} />
      <SignInButton />
    </form>
    <Link href="/reset-password/request" className="mt-4 inline-block text-sm font-bold underline">Forgot password?</Link>
    <p className="mt-4 text-[12px]" style={{ color: 'var(--txt-muted)' }}>Use your Platinum staff account. A Supabase dashboard or IntoBank login does not automatically grant access here.</p>
    <p className="mt-3 text-[12px]" style={{ color: 'var(--txt-muted)' }}>Staff accounts only. Every administrative action is written to the audit log.</p>
  </AuthPanel>;
}
