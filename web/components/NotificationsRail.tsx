"use client";

/**
 * The Notifications rail: where the unread actually is, and the switches that
 * change what arrives.
 *
 * It reads the same rows the list already loaded rather than issuing its own
 * count queries, so the number in the rail can never disagree with the number
 * on the pills.
 */
import Link from "next/link";
import { Bell, Mail, Moon, SlidersHorizontal } from "lucide-react";
import { Panel } from "@/components/ui";

export function UnreadSummary({ total, rows }: { total: number; rows: { label: string; n: number }[] }) {
  const shown = rows.filter((r) => r.n > 0);
  return (
    <Panel title="Unread summary">
      <div className="flex items-center gap-4">
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[30px] leading-none text-porcelain">{total}</span>
          <span className="mt-1 block text-[12.5px] text-ink/45">{total === 1 ? "new notification" : "new notifications"}</span>
        </span>
        {/* A ring rather than a bar: it reads at a glance and needs no axis. */}
        <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
          <circle cx="28" cy="28" r="23" fill="none" stroke="var(--color-surface-elevated)" strokeWidth="6" />
          {total > 0 ? (
            <circle
              cx="28" cy="28" r="23" fill="none" stroke="var(--color-pearl)" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={(Math.min(total, 20) / 20) * 144.5 + " 144.5"}
              transform="rotate(-90 28 28)"
            />
          ) : null}
        </svg>
      </div>
      {shown.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-ink/8 pt-3">
          {shown.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between text-[13px]">
              <span className="text-ink/70">{r.label}</span>
              <span className="tabular-nums text-ink/45">{r.n}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

export function NotificationSettingsPanel() {
  const items = [
    { icon: Bell, label: "Push notifications", href: "/settings" },
    { icon: Mail, label: "Email notifications", href: "/settings" },
    { icon: SlidersHorizontal, label: "Notification preferences", href: "/settings" },
    { icon: Moon, label: "Quiet hours", href: "/settings" },
  ];
  return (
    <Panel title="Notification settings">
      <div className="flex flex-col">
        {items.map((i) => (
          <Link
            key={i.label}
            href={i.href}
            className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-[13.5px] text-ink transition-colors duration-[140ms] hover:bg-surface"
          >
            <i.icon size={15} className="shrink-0 text-ink/45" />
            <span className="min-w-0 flex-1 truncate">{i.label}</span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}
