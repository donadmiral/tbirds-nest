"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ProductDialog } from "@/components/ProductDialog";
import styles from "@/app/market/MarketWorkspace.module.css";
import {
  LISTING_REASONS,
  REVIEW_REASONS,
  reportMarketContent,
  reviewError,
} from "../../shared/marketReviews";
export function MarketReportForm(props: Parameters<typeof MarketReportContent>[0]) {
  return <MarketReportContent key={`${props.kind}:${props.id}:${props.userId}`} {...props} />;
}

function MarketReportContent({
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
  useEffect(() => () => { generation.current += 1; }, []);
  const reasons = kind === "review" ? REVIEW_REASONS : LISTING_REASONS;
  return (
    <ProductDialog open title={`Report ${kind}`} description="Your identity is hidden from the reported person. Staff can review your report." busy={busy} onClose={onClose}>
    <form
      className={styles.form}
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
      {sent ? (
        <p role="status">Report received. Our team can now review it.</p>
      ) : (
        <>
          <label className="block text-sm">
            Reason
            <select
              aria-label="Reason"
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
              aria-label="Additional details (optional)"
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
            className={styles.primary}
          >
            {busy ? "Sending…" : "Send report"}
          </button>
        </>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={onClose}
        disabled={busy}
      >
        {sent ? "Close" : "Cancel"}
      </button>
    </form>
    </ProductDialog>
  );
}
