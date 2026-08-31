"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AtSign, Briefcase, ChevronRight, Edit3, EyeOff, FileText, HelpCircle, Info, LifeBuoy, Settings as SettingsIcon, Shield, ShieldAlert, ShieldOff, UserCheck } from "lucide-react";
import { autoplayEnabled, dataSaverEnabled, setAutoplay, setDataSaver } from "@/lib/mediaPrefs";
import { PageHeader } from "@/components/ui";
import { AccountStatus } from "@/components/AccountStatus";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function SettingsPage() {
  const [auto, setAuto] = useState(true);
  const [saver, setSaver] = useState(false);

  useEffect(() => {
    setAuto(autoplayEnabled());
    setSaver(dataSaverEnabled());
  }, []);

  const row = "flex items-center justify-between rounded-lg border border-ink/10 p-4";
  const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
    <button onClick={() => onChange(!on)} role="switch" aria-checked={on}
      className={"relative h-6 w-11 rounded-full transition-colors duration-[140ms] " + (on ? "bg-pearl" : "bg-ink/20")}
    >
      <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-[140ms] " + (on ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
  const NavRow = ({ href, icon, label, sub }: { href: string; icon: React.ReactNode; label: string; sub?: string }) => (
    <Link href={href} className="flex items-center gap-3 rounded-lg border border-ink/10 p-4 transition-colors duration-[140ms] hover:bg-surface">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pearl/15 text-pearl">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink">{label}</span>
        {sub ? <span className="block text-[12px] text-ink/50">{sub}</span> : null}
      </span>
      <ChevronRight size={16} className="shrink-0 text-ink/30" />
    </Link>
  );

  // The sections were a flat run of rows, so a page with five distinct concerns
  // read as one long list. They are cards now, with an index that jumps to each.
  const SECTIONS = [
    { id: "create", label: "Create", icon: Edit3 },
    { id: "business", label: "Business", icon: Briefcase },
    { id: "account", label: "Account", icon: UserCheck },
    { id: "device", label: "Data and appearance", icon: SettingsIcon },
    { id: "help", label: "Help", icon: HelpCircle },
  ];

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title="Settings" subtitle="Your account, privacy, and how this device behaves." />

      <div className="flex gap-6">
        <nav className="sticky top-[88px] hidden h-fit w-[210px] shrink-0 flex-col gap-0.5 rounded-2xl border border-ink/10 bg-white p-2 lg:flex">
          {SECTIONS.map((x) => (
            <a
              key={x.id}
              href={"#" + x.id}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13.5px] text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"
            >
              <x.icon size={15} className="shrink-0 text-ink/45" />
              {x.label}
            </a>
          ))}
        </nav>

        <div className="min-w-0 flex-1">

      <div id="create" className="mb-4 scroll-mt-[88px] rounded-2xl border border-ink/10 bg-white p-4">
        <h2 className="mb-2.5 text-[15px] font-semibold text-ink">Create</h2>
        <div className="flex flex-col gap-2">
        <NavRow href="/write" icon={<Edit3 size={16} />} label="Write an article" sub="Long-form publishing with a cover and read time" />
        </div>
      </div>

      <div id="business" className="mb-4 scroll-mt-[88px] rounded-2xl border border-ink/10 bg-white p-4">
        <h2 className="mb-2.5 text-[15px] font-semibold text-ink">Business</h2>
        <div className="flex flex-col gap-2">
        <NavRow href="/businesses" icon={<Briefcase size={16} />} label="Businesses" sub="Pages you run, and your team" />
        <NavRow href="/businesses/apply" icon={<Briefcase size={16} />} label="Apply for a business account" sub="Companies get their own @ and the space-grey seal" />
        </div>
      </div>

      <div id="account" className="mb-4 scroll-mt-[88px] rounded-2xl border border-ink/10 bg-white p-4">
        <h2 className="mb-2.5 text-[15px] font-semibold text-ink">Account</h2>
        <div className="flex flex-col gap-2">
        <NavRow href="/settings/username" icon={<AtSign size={16} />} label="Username" sub="Change your @handle" />
        <NavRow href="/settings/follow-requests" icon={<UserCheck size={16} />} label="Follow requests" sub="Approve who follows your private account" />
        <NavRow href="/settings/blocked" icon={<ShieldOff size={16} />} label="Blocked accounts" sub="Manage who you have blocked" />
        <NavRow href="/settings/muted" icon={<EyeOff size={16} />} label="Muted stories" sub="Manage who you have muted" />
        <NavRow href="/settings/standing" icon={<ShieldAlert size={16} />} label="Account standing" sub="Your record with Platinum Circles" />
        </div>
      </div>

      <div id="device" className="mb-4 scroll-mt-[88px] rounded-2xl border border-ink/10 bg-white p-4">
        <h2 className="mb-2.5 text-[15px] font-semibold text-ink">Data and appearance</h2>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 p-4">
            <span>
              <span className="block text-[14px] font-semibold text-ink">Appearance</span>
              <span className="block text-[12.5px] text-ink/50">Light, dark, or whatever your device uses.</span>
            </span>
            <ThemeToggle />
          </div>
        <div className={row}>
          <span>
            <span className="block text-[14px] font-semibold text-ink">Autoplay videos</span>
            <span className="block text-[12px] text-ink/50">Videos start on their own as you scroll. Off shows a poster with a play button.</span>
          </span>
          <Toggle on={auto} onChange={(v) => { setAuto(v); setAutoplay(v); }} />
        </div>
        <div className={row}>
          <span>
            <span className="block text-[14px] font-semibold text-ink">Data saver</span>
            <span className="block text-[12px] text-ink/50">Lower-size images and no video autoplay, for slow or metered connections.</span>
          </span>
          <Toggle on={saver} onChange={(v) => { setSaver(v); setDataSaver(v); }} />
        </div>
        </div>
      </div>

      <div id="help" className="mb-4 scroll-mt-[88px] rounded-2xl border border-ink/10 bg-white p-4">
        <h2 className="mb-2.5 text-[15px] font-semibold text-ink">Help</h2>
        <div className="flex flex-col gap-2">
        <NavRow href="/settings/help" icon={<HelpCircle size={16} />} label="Help & Support" sub="FAQs, submit a ticket" />
        <NavRow href="/settings/support" icon={<LifeBuoy size={16} />} label="Contact support" sub="Write to the operations team" />
        <NavRow href="/about" icon={<Info size={16} />} label="About Platinum Circles" />
        <NavRow href="/terms" icon={<FileText size={16} />} label="Terms of Service" />
        <NavRow href="/privacy" icon={<Shield size={16} />} label="Privacy Policy" />
        </div>
      </div>
        </div>

        <aside className="hidden w-[300px] shrink-0 xl:block">
          <div className="sticky top-[88px] flex flex-col gap-4">
            <AccountStatus />
          </div>
        </aside>
      </div>
    </div>
  );
}