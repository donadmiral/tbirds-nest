"use client";

/**
 * The account status rail.
 *
 * Everything here is read from the account itself. There is no score invented
 * for the sake of a number: each line is a fact the app already knows, and the
 * ones that are not yet true read as an action rather than a failure.
 */
import { useAccountResource } from "@/lib/useAccountResource";
import Link from "next/link";
import { BadgeCheck, Check, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Panel } from "@/components/ui";



type Me = {
  created_at: string | null;
  is_verified: boolean | null;
  verified_tier: string | null;
  account_type: string | null;
  username: string | null;
  avatar_url: string | null;
  headline: string | null;
};

async function loadAccountStatus(client: ReturnType<typeof createClient>, owner: string): Promise<Me> {
  const {data,error} = await client.from("profiles").select("created_at, is_verified, verified_tier, account_type, username, avatar_url, headline").eq("id",owner).maybeSingle();
  if(error || !data) throw new Error("Your account details could not load.");
  return data as Me;
}
export function AccountStatus() {
  const resource = useAccountResource<Me|null>(loadAccountStatus, null);
  const viewer=resource.viewer;
  if (resource.error) return <Panel title="Account status"><p role="status" className="text-sm text-muted">{resource.error}</p><button type="button" className="mt-2 min-h-11 text-sm font-semibold text-ink" onClick={resource.retry}>Try again</button></Panel>;
  const me = resource.data;
  if (!me) return null;
  const email = viewer?.email ?? null, confirmed = Boolean(viewer?.email_confirmed_at);

  const since = me.created_at ? new Date(me.created_at) : null;

  // Profile completeness, counted from fields that actually exist rather than
  // from a made-up percentage.
  const done = [!!me.username, !!me.avatar_url, !!me.headline, confirmed].filter(Boolean).length;
  const checks = [
    { label: "Email confirmed", ok: confirmed, href: "/settings" },
    { label: "Username set", ok: !!me.username, href: "/settings/username" },
    { label: "Profile photo", ok: !!me.avatar_url, href: '/settings/profile' },
    { label: "Headline written", ok: !!me.headline, href: '/settings/profile' },
  ];

  return (
    <>
      <Panel title="Account status">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-muted">Account type</span>
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            {me.is_verified ? <BadgeCheck size={14} className="text-accent" /> : null}
            {me.account_type === "business" ? "Business" : me.is_verified ? "Verified" : "Member"}
          </span>
        </div>
        {since ? (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[13px] text-muted">Member since</span>
            <span className="text-[13px] text-ink">{since.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
          </div>
        ) : null}
        {email ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="shrink-0 text-[13px] text-muted">Email</span>
            <span className="min-w-0 truncate text-[13px] text-ink">{email}</span>
          </div>
        ) : null}
        {!me.is_verified ? (
          <Link
            href="/settings/verification"
            className="mt-3 block rounded-full bg-pearl py-2 text-center text-[12.5px] font-bold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90"
          >
            Apply for verification
          </Link>
        ) : null}
      </Panel>

      <Panel title="Profile completeness">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[24px] leading-none text-porcelain">{done} of {checks.length}</span>
          <span className="text-[12px] text-muted">complete</span>
        </div>
        <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-surface">
          <div className="h-full rounded-full bg-pearl" style={{ width: (done / checks.length) * 100 + "%" }} />
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {checks.map((c) =>
            c.ok ? (
              <span key={c.label} className="flex items-center gap-2 text-[13px] text-ink/70">
                <Check size={13} className="shrink-0 text-success" /> {c.label}
              </span>
            ) : (
              <Link
                key={c.label}
                href={c.href}
                className="flex items-center gap-2 text-[13px] text-pearl-muted transition-opacity duration-[140ms] hover:opacity-70"
              >
                <ShieldAlert size={13} className="shrink-0" /> {c.label}
              </Link>
            ),
          )}
        </div>
      </Panel>
    </>
  );
}
