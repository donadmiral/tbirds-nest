"use client";

import { DiscoverFeed } from "@/components/DiscoverFeed";

export default function DiscoverPage() {
  return (
    <div className="px-1">
      <h1 className="pb-1 font-display text-xl text-porcelain">Discover</h1>
      <p className="pb-2 text-[13px] text-ink/50">What Zimbabwe is talking about, by interest.</p>
      <DiscoverFeed />
    </div>
  );
}