"use client";

import { DiscoverFeed } from "@/components/DiscoverFeed";
import { PageHeader } from "@/components/ui";

export default function DiscoverPage() {
  return (
    <div>
      <PageHeader title="Discover" subtitle="Explore ideas, people and opportunities that move the world forward." />
      <DiscoverFeed />
    </div>
  );
}