import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { signIn } from '@/lib/actions';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAdmin()) redirect('/dashboard');
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-6" style={{ background: 'radial-gradient(90% 70% at 50% 0%, #FFFFFF 0%, #F3F1EC 100%)' }}>
      <div className="w-full max-w-[440px] rounded-[22px] bg-white p-9 pb-8" style={{ border: '1px solid rgba(11,30,61,0.10)', boxShadow: '0 24px 60px rgba(11,30,61,0.10)' }}>
        <div className="mb-8 flex items-center gap-4">
          <img src="/brand/mark-light.png" alt="" className="w-[74px]" style={{ filter: 'drop-shadow(0 10px 14px rgba(11,30,61,0.22))' }} />
          <div>
            <img src="/brand/wordmark-light.png" alt="Platinum Circles" className="h-[22px] w-auto" />
            <p className="mt-1.5 text-[13px] font-bold" style={{ color: 'rgba(11,30,61,0.46)' }}>Operations</p>
          </div>
        </div>
        {error ? <p className="mb-3 rounded-[12px] px-3.5 py-2.5 text-[13px] font-semibold" style={{ background: '#FBEAEA', color: '#8C1D1D', border: '1px solid #F1C6C6' }}>{error}</p> : null}
        <form action={signIn} className="flex flex-col gap-3">
          <input name="email" type="email" required placeholder="Staff email" autoComplete="username"
            className="h-[54px] w-full rounded-[14px] px-4 text-[15px] outline-none transition-colors duration-150 focus:border-[#0B1E3D]"
            style={{ background: '#FAFAF9', border: '1px solid rgba(11,30,61,0.10)', color: '#0B1E3D' }} />
          <input name="password" type="password" required placeholder="Password" autoComplete="current-password"
            className="h-[54px] w-full rounded-[14px] px-4 text-[15px] outline-none transition-colors duration-150 focus:border-[#0B1E3D]"
            style={{ background: '#FAFAF9', border: '1px solid rgba(11,30,61,0.10)', color: '#0B1E3D' }} />
          <button type="submit" className="mt-1.5 h-[54px] w-full rounded-[14px] text-[16px] font-extrabold transition-opacity duration-150 hover:opacity-90" style={{ background: '#0B1E3D', color: '#F5F3EF' }}>Sign in</button>
        </form>
        <p className="mt-5 text-[12px]" style={{ color: 'rgba(11,30,61,0.46)' }}>Staff accounts only. Every action here is written to the audit log.</p>
      </div>
    </main>
  );
}