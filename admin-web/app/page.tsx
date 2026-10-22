import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { signIn } from '@/lib/actions';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAdmin()) redirect('/dashboard');
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-[440px] rounded-[22px] bg-white p-9 pb-8" style={{ border: '1px solid var(--line)', boxShadow: '0 24px 60px rgba(0,0,0,0.10)' }}>
        <div className="mb-8 flex items-center gap-4">
          <img src="/brand/mark-light.png" alt="" className="w-[74px]" style={{ filter: 'drop-shadow(0 10px 14px rgba(11,30,61,0.22))' }} />
          <div>
            <img src="/brand/wordmark-light.png" alt="Platinum Circles" className="pc-wordmark h-[22px] w-auto" />
            <p className="mt-1.5 text-[13px] font-bold" style={{ color: 'var(--txt-muted)' }}>Operations</p>
          </div>
        </div>
        {error ? <p role="alert" className="mb-3 rounded-[12px] px-3.5 py-2.5 text-[13px] font-semibold" style={{ background: 'rgba(var(--bad-rgb),0.10)', color: 'var(--bad)', border: '1px solid var(--bad)' }}>{error}</p> : null}
        <form action={signIn} className="flex flex-col gap-3">
          <input aria-label="Staff email" name="email" type="email" required placeholder="Staff email" autoComplete="username"
            className="h-[54px] w-full rounded-[14px] px-4 text-[15px] outline-none transition-colors duration-150 focus:border-[#0B1E3D]"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--txt)' }} />
          <input aria-label="Password" name="password" type="password" required placeholder="Password" autoComplete="current-password"
            className="h-[54px] w-full rounded-[14px] px-4 text-[15px] outline-none transition-colors duration-150 focus:border-[#0B1E3D]"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--txt)' }} />
          <button type="submit" className="mt-1.5 h-[54px] w-full rounded-[14px] text-[16px] font-extrabold transition-opacity duration-150 hover:opacity-90" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Sign in</button>
        </form>
        <p className="mt-5 text-[12px]" style={{ color: 'var(--txt-muted)' }}>Staff accounts only. Every action here is written to the audit log.</p>
      </div>
    </main>
  );
}
