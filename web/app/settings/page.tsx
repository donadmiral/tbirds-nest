"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AtSign, Briefcase, ChevronRight, Edit3, EyeOff, FileText, HelpCircle, Info, LifeBuoy, Settings as SettingsIcon, Shield, ShieldAlert, ShieldOff, UserCheck } from "lucide-react";
import { autoplayEnabled, dataSaverEnabled, setAutoplay, setDataSaver } from "@/lib/mediaPrefs";

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

  return (
    <div className="px-1">
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><SettingsIcon size={19} className="text-pearl" /> Settings</h1>
      <p className="pb-5 text-[13px] text-ink/50">Your account, privacy, and how this device behaves.</p>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Create</p>
      <div className="mb-6">
        <NavRow href="/write" icon={<Edit3 size={16} />} label="Write an article" sub="Long-form publishing with a cover and read time" />
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Business</p>
      <div className="mb-6">
        <NavRow href="/businesses" icon={<Briefcase size={16} />} label="Businesses" sub="Pages you run, and your team" />
        <NavRow href="/businesses/apply" icon={<Briefcase size={16} />} label="Apply for a business account" sub="Companies get their own @ and the space-grey seal" />
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Account</p>
      <div className="mb-6 flex flex-col gap-2">
        <NavRow href="/settings/username" icon={<AtSign size={16} />} label="Username" sub="Change your @handle" />
        <NavRow href="/settings/follow-requests" icon={<UserCheck size={16} />} label="Follow requests" sub="Approve who follows your private account" />
        <NavRow href="/settings/blocked" icon={<ShieldOff size={16} />} label="Blocked accounts" sub="Manage who you have blocked" />
        <NavRow href="/settings/muted" icon={<EyeOff size={16} />} label="Muted stories" sub="Manage who you have muted" />
        <NavRow href="/settings/standing" icon={<ShieldAlert size={16} />} label="Account standing" sub="Your record with Platinum Circles" />
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Data & appearance</p>
      <div className="flex flex-col gap-3">
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
      <p className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Help</p>
      <div className="flex flex-col gap-2">
        <NavRow href="/settings/help" icon={<HelpCircle size={16} />} label="Help & Support" sub="FAQs, submit a ticket" />
        <NavRow href="/settings/support" icon={<LifeBuoy size={16} />} label="Contact support" sub="Write to the operations team" />
        <NavRow href="/about" icon={<Info size={16} />} label="About Platinum Circles" />
        <NavRow href="/terms" icon={<FileText size={16} />} label="Terms of Service" />
        <NavRow href="/privacy" icon={<Shield size={16} />} label="Privacy Policy" />
      </div>
    </div>
  );
}