"use client";

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

let count: number | null = null;
let stop: (() => void) | null = null;
const listeners = new Set<() => void>();
const snapshot = () => count;
const serverSnapshot = () => null;
const emit = (next: number | null) => {
  if (next === count) return;
  count = next;
  listeners.forEach((listener) => listener());
};

function start() {
  const client = createClient();
  let alive = true;
  let viewer: string | null | undefined;
  let version = 0;
  let channel: ReturnType<typeof client.channel> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!alive || !viewer) return;
      const request = ++version;
      try {
        const result = await client.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", viewer).is("read_at", null);
        if (!result.error && alive && request === version) emit(result.count);
      } catch { /* Keep the last confirmed count until the next refresh. */ }
    }, 150);
  };
  const bind = (id: string | null) => {
    if (!alive || viewer === id) return;
    viewer = id;
    version++;
    emit(id ? null : 0);
    if (channel) { void client.removeChannel(channel); channel = null; }
    if (id) {
      channel = client.channel("unread-notifications-" + id + "-" + Math.random().toString(36).slice(2))
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: "recipient_id=eq." + id }, refresh).subscribe();
      refresh();
    }
  };
  const { data } = client.auth.onAuthStateChange((_event, session) => bind(session?.user.id ?? null));
  void client.auth.getSession().then(({ data, error }) => { if (!error && viewer === undefined) bind(data.session?.user.id ?? null); }, () => {});
  window.addEventListener("pc:notifications-changed", refresh);
  window.addEventListener("focus", refresh);
  return () => {
    alive = false; version++;
    if (timer) clearTimeout(timer);
    data.subscription.unsubscribe();
    if (channel) void client.removeChannel(channel);
    window.removeEventListener("pc:notifications-changed", refresh);
    window.removeEventListener("focus", refresh);
    count = null;
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stop) stop = start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stop?.(); stop = null; }
  };
}

// Desktop navigation and the mobile top bar share one query and subscription.
export function useUnreadNotifications() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
