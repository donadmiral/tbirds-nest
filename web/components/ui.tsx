/**
 * The surface kit.
 *
 * Every page in the web app draws the same three shapes: a bordered white card,
 * a small capitalised section heading, and a rail panel with a "View all" link.
 * They were being written by hand in each route, which is why the padding, the
 * radius and the heading size drifted page to page.
 *
 * These are the single definition. Change a radius here and it changes on all
 * fourteen routes. Nothing here fetches or decides anything; it is shape only,
 * so a page can adopt it one section at a time without a rewrite.
 */
import Link from "next/link";
import type { ReactNode } from "react";

/** The base surface: white, hairline border, 16px corners. */
export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={"rounded-2xl border border-ink/10 bg-white " + (padded ? "px-5 py-4 " : "") + className}>
      {children}
    </section>
  );
}

/**
 * A card with a heading and an optional link on the right. This is the shape
 * every rail panel and most page sections take.
 */
export function Panel({
  title,
  action,
  actionHref,
  icon,
  children,
  className = "",
}: {
  title: string;
  action?: string;
  actionHref?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {icon ? <span className="text-pearl">{icon}</span> : null}
          {title}
        </h2>
        {action && actionHref ? (
          <Link href={actionHref} className="shrink-0 text-[12.5px] text-pearl transition-opacity duration-[140ms] hover:opacity-70">
            {action}
          </Link>
        ) : null}
      </header>
      {children}
    </Card>
  );
}

/** The heading above a group of cards, not inside one. */
export function SectionTitle({ children, action, actionHref }: { children: ReactNode; action?: string; actionHref?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink/40">{children}</h2>
      {action && actionHref ? (
        <Link href={actionHref} className="text-[12.5px] text-pearl transition-opacity duration-[140ms] hover:opacity-70">
          {action}
        </Link>
      ) : null}
    </div>
  );
}

/** The title block at the top of a route. */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] leading-tight text-porcelain">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13.5px] text-ink/50">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

/**
 * An empty state is an invitation, so it always names the next action rather
 * than only reporting that there is nothing here.
 */
export function EmptyState({
  icon,
  title,
  line,
  action,
  actionHref,
}: {
  icon?: ReactNode;
  title: string;
  line?: string;
  action?: string;
  actionHref?: string;
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-10 text-center">
      {icon ? <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-pearl/12 text-pearl">{icon}</span> : null}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {line ? <p className="mt-1 max-w-[380px] text-[13.5px] leading-6 text-ink/50">{line}</p> : null}
      {action && actionHref ? (
        <Link
          href={actionHref}
          className="mt-4 rounded-full bg-pearl px-5 py-2 text-[13px] font-bold text-ink transition-opacity duration-[140ms] hover:opacity-90"
        >
          {action}
        </Link>
      ) : null}
    </Card>
  );
}

/** A numbered rail row: rank, label, and a quiet count underneath. */
export function RankRow({ rank, label, meta, href }: { rank: number; label: string; meta?: string; href: string }) {
  return (
    <Link href={href} className="-mx-2 flex items-baseline gap-3 rounded-lg px-2 py-1.5 transition-colors duration-[140ms] hover:bg-surface">
      <span className="w-3 shrink-0 text-[12.5px] tabular-nums text-ink/35">{rank}</span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{label}</span>
      {meta ? <span className="shrink-0 text-[12px] text-ink/40">{meta}</span> : null}
    </Link>
  );
}

/** Pill tabs, the row that sits under a page title. */
export function PillTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            className={
              "rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-[140ms] " +
              (on ? "bg-pearl text-ink" : "border border-ink/10 text-ink/60 hover:bg-surface hover:text-ink")
            }
          >
            {t.label}
            {typeof t.count === "number" ? <span className={"ml-1.5 " + (on ? "text-ink/60" : "text-ink/35")}>{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A skeleton row, for lists that are loading.
 *
 * Takes the shape of the thing it stands in for, so the layout does not shift
 * when real content arrives.
 */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="mb-3 flex items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3.5">
          <div className="h-10 w-10 shrink-0 rounded-full bg-surface" />
          <div className="min-w-0 flex-1">
            <div className="h-[13px] w-[45%] rounded bg-surface" />
            <div className="mt-1.5 h-[11px] w-[70%] rounded bg-surface/70" />
          </div>
        </div>
      ))}
    </div>
  );
}
