import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { signIn } from '@/lib/actions';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAdmin()) redirect('/dashboard');
  const { error } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0B1E3D]">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 h-12 w-12 rounded-full border-4 border-[#C9BFB0] flex items-center justify-center">
            <div className="h-4 w-4 rounded-full bg-[#F3EFE7] border border-[#0B1E3D]/10" />
          </div>
          <h1 className="text-lg font-extrabold text-[#0B1E3D]">Platinum Circles</h1>
          <p className="text-xs text-[#0B1E3D]/50 mt-1">Operations - authorized administrators only</p>
        </div>
        {error ? <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p> : null}
        <form action={signIn} className="space-y-3">
          <input name="email" type="email" required placeholder="Email"
            className="w-full rounded-xl border border-[#0B1E3D]/15 px-3.5 py-2.5 text-sm text-[#0B1E3D] outline-none focus:border-[#0B1E3D]" />
          <input name="password" type="password" required placeholder="Password"
            className="w-full rounded-xl border border-[#0B1E3D]/15 px-3.5 py-2.5 text-sm text-[#0B1E3D] outline-none focus:border-[#0B1E3D]" />
          <button type="submit" className="w-full rounded-xl bg-[#0B1E3D] py-2.5 text-sm font-bold text-white hover:opacity-90">
            Enter the desk
          </button>
        </form>
        <p className="mt-5 text-center text-[10px] text-[#0B1E3D]/40">Every action here is written to the audit log.</p>
      </div>
    </main>
  );
}