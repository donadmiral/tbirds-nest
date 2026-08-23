"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const ROOTS = ["/home", "/login", "/signup", "/business-login", "/"];

// One back arrow for the whole app, every screen can step backwards.
export function GlobalBack() {
  const pathname = usePathname();
  const router = useRouter();
  if (ROOTS.includes(pathname)) return null;
  return (
    <button onClick={() => router.back()} aria-label="Go back"
      className="fixed left-[276px] top-4 z-40 flex items-center gap-1.5 rounded-full border border-ink/10 bg-white/90 px-3 py-1.5 text-[13px] font-semibold text-ink/60 shadow-sm backdrop-blur transition-colors hover:bg-surface hover:text-ink max-lg:left-3"
    >
      <ArrowLeft size={16} /> Back
    </button>
  );
}