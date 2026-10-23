import { authEnvironment } from '@/lib/adminRecoveryPolicy';

export default function AuthPanel({ children }: { children: React.ReactNode }) {
  const environment = authEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL);
  return <main className="flex min-h-screen items-center justify-center px-6 py-10" style={{ background: 'var(--bg)' }}>
    <section className="w-full max-w-[440px] rounded-[22px] p-9 pb-8" style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: '0 24px 60px rgba(0,0,0,0.10)' }}>
      <div className="mb-6 flex items-center gap-4">
        <img src="/brand/mark-light.png" alt="" className="w-[74px]" />
        <div><img src="/brand/wordmark-light.png" alt="Platinum Circles" className="pc-wordmark h-[22px] w-auto" />
          <p className="mt-1.5 text-[13px] font-bold" style={{ color: 'var(--txt-muted)' }}>Operations</p></div>
      </div>
      <div className="mb-5 rounded-xl border p-3 text-[13px]" style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}>
        <p className="font-bold">{environment.label}</p><p className="mt-1">{environment.detail}</p>
      </div>
      {children}
    </section>
  </main>;
}
