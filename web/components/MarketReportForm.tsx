"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  LISTING_REASONS,
  REVIEW_REASONS,
  reportMarketContent,
  reviewError,
} from "../../shared/marketReviews";
export function MarketReportForm({
  kind,
  id,
  userId,
  onClose,
}: {
  kind: "review" | "listing";
  id: string;
  userId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    generation.current++;
    pending.current = false;
    setBusy(false);
    setReason("");
    setDetail("");
    setError("");
    setSent(false);
    return () => {
      generation.current++;
    };
  }, [id, userId, kind]);
  const reasons = kind === "review" ? REVIEW_REASONS : LISTING_REASONS;
  return (
    <form
      className="my-3 rounded-xl border border-ink/15 bg-surface p-4"
      aria-label={`Report ${kind}`}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current || !reason) return;
        const version = generation.current;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
          await reportMarketContent(
            createClient(),
            userId,
            kind,
            id,
            reason,
            detail,
          );
          if (version === generation.current) setSent(true);
        } catch (e) {
          if (version === generation.current) setError(reviewError(e));
        } finally {
          if (version === generation.current) {
            pending.current = false;
            setBusy(false);
          }
        }
      }}
    >
      <h3 className="font-semibold">Report {kind}</h3>
      <p className="my-2 text-sm text-muted">
        Your identity is hidden from the reported person. Staff can review your
        report.
      </p>
      {sent ? (
        <p role="status">Report received. Our team can now review it.</p>
      ) : (
        <>
          <label className="block text-sm">
            Reason
            <select
              className="mt-1 block w-full rounded-lg border border-ink/20 bg-surface p-3"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              disabled={busy}
            >
              <option value="">Choose a reason</option>
              {reasons.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Additional details (optional)
            <textarea
              className="mt-1 block w-full rounded-lg border border-ink/20 bg-surface p-3"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              maxLength={1000}
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !reason}
            className="mt-3 rounded-lg bg-navy px-4 py-2 text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send report"}
          </button>
        </>
      )}
      <button
        type="button"
        className="ml-4 mt-3 underline"
        onClick={onClose}
        disabled={busy}
      >
        {sent ? "Close" : "Cancel"}
      </button>
    </form>
  );
}
