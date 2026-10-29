"use client";

import { useRef, useState } from "react";
import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { applicationCvDownload } from "@/lib/applicationCv";

export function ApplicationCvLink({ reference, name }: { reference: string; name?: string | null }) {
  const [client] = useState(createClient);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy.current) return;
    busy.current = true;
    setPending(true); setError(null);
    // Open synchronously so browser popup protection does not block the signed URL.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const url = await applicationCvDownload(client, reference, name);
      if (tab) tab.location.replace(url);
      else window.location.assign(url);
    } catch (reason) {
      tab?.close();
      setError(reason instanceof Error ? reason.message : "The CV could not be opened. Please try again.");
    } finally { busy.current = false; setPending(false); }
  }

  return <span className="inline-flex flex-col items-start gap-1">
    <button type="button" disabled={pending} aria-busy={pending} onClick={() => void open()}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-surface px-3 py-1.5 text-[13px] text-ink hover:bg-surface-elevated disabled:opacity-60">
      <FileText size={14} aria-hidden /> {pending ? "Opening CV…" : name || "Open CV"}
    </button>
    {error ? <span role="alert" className="max-w-sm text-[12px] text-danger">{error}</span> : null}
  </span>;
}
