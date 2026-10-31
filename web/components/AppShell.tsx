import Link from "next/link";
import { getServerViewer } from "@/lib/serverViewer";
import { Nav } from "@/components/Nav";
import { MobileTabBar } from "@/components/MobileTabBar";
import { WebCallLayer } from "@/components/WebCallLayer";
import { GlobalMediaLightbox } from "@/components/GlobalMediaLightbox";
import { ScrollMemory } from "@/components/ScrollMemory";
import { TopBar } from "@/components/TopBar";
import { RememberNavigationChrome } from "@/components/NavigationLoading";
import chrome from "./NavigationChrome.module.css";

export async function AppShell({
  children,
  wide = false,
  rail = false,
  railContent,
  professional = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
  rail?: boolean;
  /** A route's own rail panels. Falls back to discovery when omitted. */
  railContent?: React.ReactNode;
  professional?: boolean;
}) {
  const { supabase, user } = await getServerViewer();
  const data = { user };
  if (!data.user) {
    return (
      <div className="min-h-screen">
        <RememberNavigationChrome identity={null} />
        <a href="#main-content" className={chrome.skipLink}>Skip to content</a>
        <header className={chrome.surface + " sticky top-0 z-20 flex items-center justify-between gap-3 border-b px-3 py-3 sm:px-6"}>
          <Link href="/" className="flex items-center gap-3">
            <span className="h-7 w-7 rounded-full border-2 border-pearl" aria-hidden />
            <span className="font-display text-base tracking-wide text-ink sm:text-lg">Platinum Circles</span>
          </Link>
          <Link href="/login" className="flex min-h-12 shrink-0 items-center rounded-full bg-pearl px-4 py-2 text-sm font-semibold text-on-pearl transition-opacity hover:opacity-90">
            Sign in
          </Link>
        </header>
        <main id="main-content" tabIndex={-1} className="flex justify-center px-6 py-8">
          <div className="w-full min-w-0 max-w-[640px] transition-[max-width] duration-200 [.nav-collapsed_&]:max-w-[760px]">{children}</div>
        </main>
      </div>
    );
  }
  if (professional) return <div className={chrome.professionalMain}>
    <a href="#main-content" className={chrome.skipLink}>Skip to workspace</a>
    <WebCallLayer /><GlobalMediaLightbox /><ScrollMemory />
    <main id="main-content" tabIndex={-1}>{children}</main>
  </div>;
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username, account_type, avatar_url, is_verified, verified_tier")
    .eq("id", data.user.id)
    .maybeSingle();
  return (
    <div className="min-h-screen">
      <RememberNavigationChrome identity={{ ownerId: data.user.id, name: profile?.full_name ?? "Member", username: profile?.username ?? "", business: profile?.account_type === "business", avatarUrl: profile?.avatar_url ?? null }} />
      <a href="#main-content" className={chrome.skipLink}>Skip to content</a>
      <Nav name={profile?.full_name ?? "Member"} username={profile?.username ?? ""} business={profile?.account_type === "business"} avatarUrl={profile?.avatar_url ?? null} verified={!!profile?.is_verified} tier={profile?.verified_tier ?? null} />
      <MobileTabBar userId={data.user.id} username={profile?.username} name={profile?.full_name} avatarUrl={profile?.avatar_url} business={profile?.account_type === 'business'} />
      <WebCallLayer />
      <GlobalMediaLightbox />
      <ScrollMemory />
      <div className={chrome.frame}>
        <TopBar name={profile?.full_name ?? "Member"} username={profile?.username ?? ""} avatarUrl={profile?.avatar_url} />
        {wide ? (
          <main id="main-content" tabIndex={-1} className={chrome.wideContent}>{children}</main>
        ) : rail && railContent ? (
          <main id="main-content" tabIndex={-1} className={chrome.content}>
            <div className={chrome.mainColumn}>{children}</div>
            <aside className={chrome.rightRail} aria-label="From your circles">
              <div>{railContent}</div>
            </aside>
          </main>
        ) : (
          <main id="main-content" tabIndex={-1} className={chrome.content}>
            <div className={chrome.mainColumn}>{children}</div>
          </main>
        )}
      </div>
    </div>
  );
}
