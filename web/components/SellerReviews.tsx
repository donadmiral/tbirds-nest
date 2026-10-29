"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { RelativeTime } from "@/components/RelativeTime";
import {
  getSellerReviewPage,
  submitSellerReview,
  reviewError,
  type ReviewPage,
  type ReviewCursor,
} from "../../shared/marketReviews";
import { MarketReportForm } from "./MarketReportForm";
export function SellerReviews({
  sellerId,
  listingId,
  viewerId,
}: {
  sellerId: string;
  listingId?: string | null;
  viewerId: string | null;
}) {
  const [storedPage, setPage] = useState<ReviewPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const saving = useRef(false);
  const scope = `${sellerId}:${listingId || ""}:${viewerId || ""}`;
  const loadedScope = useRef("");
  const page = loadedScope.current === scope ? storedPage : null;
  const load = useCallback(
    async (cursor?: ReviewCursor) => {
      const version = generation.current;
      if (inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      setError("");
      try {
        const data = await getSellerReviewPage(
          createClient(),
          sellerId,
          listingId,
          cursor,
        );
        if (version !== generation.current) return;
        loadedScope.current = scope;
        setPage((old) =>
          cursor && old
            ? {
                ...data,
                rows: [
                  ...old.rows,
                  ...data.rows.filter(
                    (row) => !old.rows.some((r) => r.id === row.id),
                  ),
                ],
              }
            : data,
        );
      } catch (e) {
        if (version === generation.current) setError(reviewError(e));
      } finally {
        if (version === generation.current) {
          setLoading(false);
          inFlight.current = false;
        }
      }
    },
    [sellerId, listingId, scope],
  );
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    saving.current = false;
    setPage(null);
    setBusy(false);
    setLoading(false);
    setError("");
    setOrder("");
    setRating(0);
    setComment("");
    setReport(null);
    setSaved(false);
    if (viewerId) void load();
    return () => {
      generation.current++;
    };
  }, [load, viewerId]);
  if (!viewerId)
    return (
      <p className="mt-5 text-sm text-muted">
        Sign in to see verified purchase reviews.
      </p>
    );
  const selected = page?.eligible_orders.find((o) => o.id === order);
  return (
    <section className="mt-7 border-t border-ink/10 pt-5">
      <h2 className="text-base font-semibold">Seller reviews</h2>
      {page && (
        <p className="mt-1 text-sm text-muted">
          {page.summary.review_count
            ? `${Number(page.summary.avg_rating).toFixed(1)} stars · ${page.summary.review_count} verified purchase reviews`
            : "No verified purchase reviews yet."}
        </p>
      )}
      {error && (
        <p role="alert" className="my-3 text-sm text-danger">
          {error}{" "}
          <button
            className="underline"
            onClick={() => void load()}
            disabled={loading}
          >
            Retry
          </button>
        </p>
      )}
      {loading && (
        <p role="status" className="my-3 text-sm">
          Loading reviews…
        </p>
      )}
      {!!page?.eligible_orders.length && (
        <form
          className="my-4 rounded-xl border border-ink/10 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving.current || inFlight.current || !order || !rating) return;
            const version = generation.current;
            saving.current = true;
            setBusy(true);
            setSaved(false);
            setError("");
            try {
              await submitSellerReview(
                createClient(),
                viewerId,
                order,
                rating,
                comment,
              );
              if (version === generation.current) {
                setSaved(true);
                await load();
              }
            } catch (e) {
              if (version === generation.current) setError(reviewError(e));
            } finally {
              if (version === generation.current) {
                saving.current = false;
                setBusy(false);
              }
            }
          }}
        >
          <label className="text-sm font-medium">
            Completed purchase
            <select
              required
              className="mt-1 block w-full rounded-lg border border-ink/20 bg-surface p-3"
              value={order}
              onChange={(e) => {
                const id = e.target.value;
                const o = page.eligible_orders.find((x) => x.id === id);
                setOrder(id);
                setRating(o?.rating || 0);
                setComment(o?.comment || "");
                setSaved(false);
              }}
              disabled={busy}
            >
              <option value="">Choose a completed order</option>
              {page.eligible_orders.map((o) => (
                <option value={o.id} key={o.id}>
                  {o.title} · {new Date(o.completed_at).toLocaleDateString()} ·{" "}
                  {o.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {selected?.moderation_status === "hidden" ? (
            <p className="mt-2 text-sm">
              This review was removed. Contact support to appeal.
            </p>
          ) : (
            <>
              <div className="my-3 flex gap-2" role="group" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    aria-pressed={rating === n}
                    disabled={busy}
                    onClick={() => setRating(n)}
                    className="rounded p-2 focus-visible:outline"
                  >
                    <Star
                      size={22}
                      fill={n <= rating ? "currentColor" : "none"}
                      className="text-accent"
                    />
                  </button>
                ))}
              </div>
              <label className="text-sm">
                Review
                <textarea
                  className="mt-1 block w-full rounded-lg border border-ink/20 bg-surface p-3"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  disabled={busy}
                />
              </label>
              <button
                disabled={busy || loading || !rating || !order}
                className="mt-3 rounded-lg bg-navy px-4 py-2 text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save review"}
              </button>
            </>
          )}
          {saved && (
            <p role="status" className="mt-2 text-sm">
              Review saved.
            </p>
          )}
        </form>
      )}
      {page && !page.eligible_orders.length && viewerId !== sellerId && (
        <p className="my-3 text-sm text-muted">
          You can review after completing a purchase from this seller.
        </p>
      )}
      {page?.rows.map((r) => (
        <article className="border-t border-ink/10 py-4" key={r.id}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">
              {r.reviewer?.full_name || "Member"}{" "}
              <VerifiedBadge userId={r.reviewer?.id} size={13} />
            </span>
            <span aria-label={`${r.rating} out of 5 stars`}>
              {"★".repeat(r.rating)}
              {"☆".repeat(5 - r.rating)}
            </span>
            <span className="text-muted"><RelativeTime dateTime={r.created_at} /></span>
          </div>
          <p className="mt-1 text-xs text-muted">Verified purchase</p>
          {r.comment && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">
              {r.comment}
            </p>
          )}
          {viewerId !== r.reviewer_id && (
            <button
              className="mt-2 text-xs underline"
              onClick={() => setReport(report === r.id ? null : r.id)}
            >
              Report review
            </button>
          )}
          {report === r.id && (
            <MarketReportForm
              kind="review"
              id={r.id}
              userId={viewerId}
              onClose={() => setReport(null)}
            />
          )}
        </article>
      ))}
      {page?.has_more && page.next_cursor && (
        <button
          disabled={loading}
          className="my-3 underline"
          onClick={() => void load(page.next_cursor!)}
        >
          Load older reviews
        </button>
      )}
    </section>
  );
}
