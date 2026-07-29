import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { signIn } from '@/lib/actions';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAdmin()) redirect('/dashboard');
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0A1730]">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <img src="/pearl.png" alt="" className="mx-auto h-16 w-16" />
          <h1 className="mt-4 text-[17px] font-bold text-white">Platinum Circles</h1>
          <p className="mt-1 text-[12px] text-white/40">Operations - authorized administrators only</p>
        </div>
        <div className="rounded-[14px] border border-white/10 bg-white p-6">
          {error ? <p className="mb-4 rounded-[10px] border border-red-100 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">{error}</p> : null}
          <form action={signIn} className="space-y-3">
            <input name="email" type="email" required placeholder="Email"
              className="w-full rounded-[10px] border border-[#E8E6E1] px-3.5 py-2.5 text-[13.5px] text-[#17181C] outline-none transition-colors duration-150 focus:border-[#0B1E3D]" />
            <input name="password" type="password" required placeholder="Password"
              className="w-full rounded-[10px] border border-[#E8E6E1] px-3.5 py-2.5 text-[13.5px] text-[#17181C] outline-none transition-colors duration-150 focus:border-[#0B1E3D]" />
            <button type="submit" className="w-full rounded-[10px] bg-[#0B1E3D] py-2.5 text-[13.5px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Enter the desk</button>
          </form>
        </div>
        <p className="mt-5 text-center text-[10.5px] text-white/30">Every action here is written to the audit log.</p>
      </div>
    </main>
  );
}