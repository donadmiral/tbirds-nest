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
      className="mb-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-semibold text-ink/55 transition-colors hover:bg-surface hover:text-ink"
    >
      <ArrowLeft size={16} /> Back
    </button>
  );
}