"use client";

// Its own file, because the retry button makes it interactive and the rest
// of the surface kit must stay server-renderable.
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * A failed load, with a way out.
 *
 * The audit found exactly one file in the app that offered retry: everywhere
 * else a caught error either showed nothing or left a spinner running forever.
 * This gives every screen the same recovery affordance.
 */
export function ErrorState({
  title = "Could not load this",
  line = "The connection may have dropped. Trying again usually works.",
  onRetry,
}: {
  title?: string;
  line?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white px-5 py-8 text-center">
      <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-pearl/15 text-pearl">
        <AlertTriangle size={18} />
      </span>
      <p className="text-[14.5px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-[320px] text-[13px] leading-6 text-ink/50">{line}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-ink/15 px-4 py-2 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"
        >
          <RotateCcw size={13} /> Try again
        </button>
      ) : null}
    </div>
  );
}
