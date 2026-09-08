import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { MobileTabBar } from "@/components/MobileTabBar";
import { WebCallLayer } from "@/components/WebCallLayer";
import { GlobalMediaLightbox } from "@/components/GlobalMediaLightbox";
import { GlobalBack } from "@/components/GlobalBack";
import { ScrollMemory } from "@/components/ScrollMemory";
import { TopBar } from "@/components/TopBar";

export async function AppShell({
  children,
  wide = false,
  rail = false,
  railContent,
}: {
  children: React.ReactNode;
  wide?: boolean;
  rail?: boolean;
  /** A route's own rail panels. Falls back to discovery when omitted. */
  railContent?: React.ReactNode;
}) {
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
          <div className="w-full max-w-[640px] transition-[max-width] duration-200 [.nav-collapsed_&]:max-w-[760px]">{children}</div>
        </main>
      </div>
    );
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username, account_type, avatar_url, is_verified, verified_tier")
    .eq("id", data.user.id)
    .maybeSingle();
  return (
    <div className="min-h-screen">
      <Nav name={profile?.full_name ?? "Member"} username={profile?.username ?? ""} business={profile?.account_type === "business"} avatarUrl={profile?.avatar_url ?? null} verified={!!profile?.is_verified} tier={profile?.verified_tier ?? null} />
      <MobileTabBar username={profile?.username ?? ""} avatarUrl={profile?.avatar_url ?? null} />
      <WebCallLayer />
      <GlobalMediaLightbox />
      <GlobalBack />
      <ScrollMemory />
      <div className="ml-0 transition-[margin] duration-200 md:ml-[260px] [.nav-collapsed_&]:md:ml-[76px]">
        <TopBar name={profile?.full_name ?? "Member"} username={profile?.username ?? ""} avatarUrl={profile?.avatar_url} />
        {wide ? (
          <main className="px-3 pb-24 pt-3 md:-mt-[60px] md:px-6 md:pb-10 md:pt-[76px]">{children}</main>
        ) : rail && railContent ? (
          <main className="flex justify-center gap-6 px-3 pb-24 pt-3 md:-mt-[60px] md:px-6 md:pb-10 md:pt-[76px]">
            <div className="w-full min-w-0 max-w-[640px] transition-[max-width] duration-200 [.nav-collapsed_&]:max-w-[720px]">{children}</div>
            <aside className="hidden w-[340px] shrink-0 xl:block">
              <div className="sticky top-[88px] flex flex-col gap-4">{railContent}</div>
            </aside>
          </main>
        ) : (
          <main className="flex justify-center px-3 pb-24 pt-3 md:-mt-[60px] md:px-6 md:pb-10 md:pt-[76px]">
            <div className="w-full max-w-[640px] transition-[max-width] duration-200 [.nav-collapsed_&]:max-w-[760px]">{children}</div>
          </main>
        )}
      </div>
    </div>
  );
}