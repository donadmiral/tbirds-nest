"use client";

import { useSyncExternalStore } from "react";

// A single external clock keeps labels and expiry controls consistent. Null is
// the server snapshot, so hydration never compares different execution times.
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

export function useCurrentTime(): number | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
