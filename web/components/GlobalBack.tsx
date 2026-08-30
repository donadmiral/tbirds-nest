"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// Top-level destinations own their own title area, so a floating back button
// there lands on top of the heading rather than beside it. These are the pages
// reached from the sidebar: there is nothing to go "back" to from them.
const ROOTS = [
  "/", "/home", "/login", "/signup", "/business-login",
  "/discover", "/search", "/jobs", "/market", "/messages", "/channels",
  "/communities", "/notifications", "/saved", "/ads", "/settings", "/studio",
];

// One back arrow for the whole app, every screen can step backwards.
export function GlobalBack() {
  const pathname = usePathname();
  const router = useRouter();
  if (ROOTS.includes(pathname)) return null;
  // Studio's desks carry their own tab bar, and the arrow would sit on the
  // title block there too.
  if (pathname.startsWith("/studio")) return null;
  return (
    <button onClick={() => router.back()} aria-label="Go back"
      className="fixed left-[276px] top-4 z-40 flex items-center gap-1.5 rounded-full border border-ink/10 bg-white/90 px-3 py-1.5 text-[13px] font-semibold text-ink/60 shadow-sm backdrop-blur transition-colors hover:bg-surface hover:text-ink max-lg:left-3"
    >
      <ArrowLeft size={16} /> Back
    </button>
  );
}