import Link from "next/link";
import { Compass, SearchX } from "lucide-react";

/** Shown for any URL that matches no route, including a profile that does not exist. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-[420px] text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface text-ink/40">
          <SearchX size={22} />
        </span>
        <h1 className="font-display text-[22px] leading-tight text-porcelain">This page does not exist</h1>
        <p className="mt-2 text-[13.5px] leading-6 text-ink/55">
          The link may be broken, or whatever was here has been removed.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2.5">
          <Link
            href="/home"
            className="rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"
          >
            Back to home
          </Link>
          <Link
            href="/discover"
            className="flex items-center gap-1.5 rounded-full border border-ink/15 px-4 py-2 text-[13px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"
          >
            <Compass size={14} /> Discover
          </Link>
        </div>
      </div>
    </div>
  );
}
