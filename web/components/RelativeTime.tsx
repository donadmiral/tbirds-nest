"use client";

import { useCurrentTime } from "@/lib/useCurrentTime";
import { absolutePostDate, timeAgo } from "@/lib/feed";

export function RelativeTime({ dateTime }: { dateTime: string }) {
  const current = useCurrentTime();
  const date = new Date(dateTime);
  const valid = Number.isFinite(date.getTime());
  return <time dateTime={valid ? date.toISOString() : undefined}
    title={valid ? date.toUTCString() : "Date unavailable"}>
    {current === null ? absolutePostDate(dateTime) : timeAgo(dateTime, current)}
  </time>;
}
