"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, X } from "lucide-react";

export function SettingsNavigation() {
  const pathname = usePathname();
  const root = pathname === "/settings";
  const ticket = pathname.startsWith("/settings/support/");
  const parent = root ? "/home" : ticket ? "/settings/support" : "/settings";
  const label = root ? "Home" : ticket ? "Support" : "Settings";
  return (
    <nav aria-label="Settings navigation" className="mx-auto mb-3 flex max-w-[1180px] items-center justify-between gap-4">
      <Link href={parent} replace aria-label={"Back to " + label} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink hover:bg-surface">
        <ArrowLeft size={19} /> {label}
      </Link>
      {!root ? <Link href="/home" replace aria-label="Exit settings to Home" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm text-secondary hover:bg-surface"><span>Exit settings</span><X size={18} /></Link> : null}
    </nav>
  );
}
