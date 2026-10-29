"use client";

import { useSyncExternalStore } from "react";
import { absolutePostDate, timeAgo } from "@/lib/feed";

// All labels share one clock. The server and the first hydration render use
// null, so neither execution time nor the viewer's timezone can change HTML.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
function refresh() {
  now = Date.now();
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    refresh();
    timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", refresh);
    }
  };
}
const snapshot = () => now;
const serverSnapshot = () => null;

export function RelativeTime({ dateTime }: { dateTime: string }) {
  const current = useSyncExternalStore<number | null>(subscribe, snapshot, serverSnapshot);
  const date = new Date(dateTime);
  const valid = Number.isFinite(date.getTime());
  return <time dateTime={valid ? date.toISOString() : undefined}
    title={valid ? date.toUTCString() : "Date unavailable"}>
    {current === null ? absolutePostDate(dateTime) : timeAgo(dateTime, current)}
  </time>;
}
