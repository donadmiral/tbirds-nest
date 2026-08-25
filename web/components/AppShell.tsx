import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { WebCallLayer } from "@/components/WebCallLayer";
import { GlobalMediaLightbox } from "@/components/GlobalMediaLightbox";
import { GlobalBack } from "@/components/GlobalBack";
import { DiscoveryRail } from "@/components/DiscoveryRail";

export async function AppShell({ children, wide = false, rail = false }: { children: React.ReactNode; wide?: boolean; rail?: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-ink/10 bg-ink/90 px-6 py-3 backdrop-blur">
          <Link href="/" className="flex items-center gap-3">
            <span className="h-7 w-7 rounded-full border-2 border-pearl" aria-hidden />
            <span className="font-display text-lg tracking-wide text-porcelain">Platinum Circles</span>
          </Link>
          <Link href="/login" className="rounded-md bg-pearl px-4 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90">
            Sign in
          </Link>
        </header>
        <main className="flex justify-center px-6 py-8">
          <div className="w-full max-w-[640px]">{children}</div>
        </main>
      </div>
    );
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username, account_type")
    .eq("id", data.user.id)
    .maybeSingle();
  return (
    <div className="min-h-screen">
      <Nav name={profile?.full_name ?? "Member"} username={profile?.username ?? ""} business={profile?.account_type === "business"} />
      <WebCallLayer />
      <GlobalMediaLightbox />
      <GlobalBack />
      {wide ? (
        <main className="ml-[260px]">{children}</main>
      ) : rail ? (
        <main className="ml-[260px] flex justify-center gap-6 px-4 py-8">
          <div className="w-full min-w-0 max-w-[640px]">{children}</div>
          <aside className="hidden w-80 shrink-0 xl:block">
            <DiscoveryRail />
          </aside>
        </main>
      ) : (
        <main className="ml-[260px] flex justify-center px-6 py-8">
          <div className="w-full max-w-[640px]">{children}</div>
        </main>
      )}
    </div>
  );
}