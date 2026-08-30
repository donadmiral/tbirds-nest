"use client";

/**
 * The connection banner.
 *
 * The audit found no offline handling anywhere: losing signal mid-session left
 * every screen looking broken, because a failed query and a dead connection
 * produce the same blank result. This tells the difference.
 *
 * navigator.onLine alone is not trustworthy. It reports the network interface,
 * not whether anything is reachable, so a captive portal or a dead uplink still
 * reads as online. A cheap reachability check confirms it before we claim to be
 * back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, RotateCcw, Wifi } from "lucide-react";

type State = "online" | "offline" | "restored";

export function ConnectionBanner() {
  const [state, setState] = useState<State>("online");
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const verify = useCallback(async () => {
    try {
      // A HEAD to our own origin: no third party, no cache, tiny payload.
      await fetch("/favicon.ico", { method: "HEAD", cache: "no-store" });
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const goOffline = () => { if (!cancelled) setState("offline"); };

    const goOnline = async () => {
      const reachable = await verify();
      if (cancelled || !reachable) return;
      setState((prev) => (prev === "offline" ? "restored" : "online"));
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    // The events do not fire if the page loads while already offline.
    if (typeof navigator !== "undefined" && navigator.onLine === false) goOffline();

    return () => {
      cancelled = true;
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [verify]);

  useEffect(() => {
    if (state !== "restored") return;
    // The restored message is an acknowledgement, not a state to sit in.
    restoreTimer.current = setTimeout(() => setState("online"), 3200);
    return () => { if (restoreTimer.current) clearTimeout(restoreTimer.current); };
  }, [state]);

  if (state === "online") return null;

  const offline = state === "offline";

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2.5 px-4 py-2.5 text-[13px] font-medium " +
        (offline ? "bg-ink text-white" : "bg-success text-white")
      }
    >
      {offline ? <CloudOff size={15} /> : <Wifi size={15} />}
      <span>{offline ? "You are offline. Changes will not save until the connection returns." : "Back online"}</span>
      {offline ? (
        <button
          onClick={() => window.location.reload()}
          className="ml-1 flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[12px] font-semibold transition-colors duration-[140ms] hover:bg-white/25"
        >
          <RotateCcw size={12} /> Reload
        </button>
      ) : null}
    </div>
  );
}
