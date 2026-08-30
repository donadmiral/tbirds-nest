"use client";

/**
 * The app-wide error boundary.
 *
 * Next.js renders this instead of its default error page whenever a route
 * throws during render or data loading. Before this existed, any uncaught
 * error anywhere in 65 routes produced the framework's stack-trace screen,
 * which tells the person nothing and offers them no way out.
 *
 * The reset() callback re-runs the failed render, so a transient failure (a
 * dropped connection, a timed-out query) recovers in place without a reload.
 */
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Kept so the failure is visible in the console during development and
    // ready for a reporter (Sentry or similar) to hook into later.
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-[420px] text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-pearl/15 text-pearl">
          <AlertTriangle size={22} />
        </span>
        <h1 className="font-display text-[22px] leading-tight text-porcelain">Something went wrong</h1>
        <p className="mt-2 text-[13.5px] leading-6 text-ink/55">
          This page failed to load. It is usually temporary, so trying again often works.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2.5">
          <button
            onClick={reset}
            className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"
          >
            <RotateCcw size={14} /> Try again
          </button>
          <Link
            href="/home"
            className="rounded-full border border-ink/15 px-4 py-2 text-[13px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"
          >
            Back to home
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-4 text-[11.5px] text-ink/30">Reference {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
