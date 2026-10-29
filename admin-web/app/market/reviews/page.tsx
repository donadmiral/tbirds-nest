import Link from "next/link";
import { requirePermission } from "@/lib/adminAuth";
import { serviceClient } from "@/lib/supabaseAdmin";
import Shell from "@/components/Shell";
import CommandForm from "@/components/CommandForm";
import { moderateReview } from "./actions";
import { isMissingAdminRpc } from "@/lib/adminRpcAvailability";
export const dynamic = "force-dynamic";
type Report = {
  id: string;
  review_id: string | null;
  reporter_id: string | null;
  reason: string;
  detail: string;
  status: string;
  created_at: string;
  seller_id: string | null;
  reviewer_id: string | null;
  rating: number | null;
  review_version: number;
  current_version: number | null;
  comment: string | null;
  moderation_status: "visible" | "hidden" | null;
  order_id: string | null;
};
export default async function ReviewReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; id?: string; status?: string }>;
}) {
  const admin = await requirePermission("report_listing");
  const params = await searchParams;
  const status = params.status === "all" ? "all" : "open";
  const validCursor =
    typeof params.before === "string" &&
    Number.isFinite(Date.parse(params.before)) &&
    typeof params.id === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(params.id);
  const { data, error } = await serviceClient().rpc(
    "admin_seller_review_reports",
    {
      p_actor_id: admin.id,
      p_session_id: admin.sessionId,
      p_status: status,
      p_before_at: validCursor ? params.before : null,
      p_before_id: validCursor ? params.id : null,
    },
  );
  if (isMissingAdminRpc(error, 'admin_seller_review_reports')) {
    return <Shell admin={admin} active="/reports" title="Seller review reports" sub="Seller review reporting is unavailable on this deployment.">
      <Link href="/reports" className="mb-5 inline-block underline">Reports desk</Link>
      <p role="status" className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-6">Seller review reports and review decisions are unavailable on this deployment. Existing post, listing and account reports remain available from the Reports desk according to your staff permissions.</p>
    </Shell>;
  }
  if (error || !data)
    throw new Error("Review reports could not be loaded. Please retry.");
  const page = data as {
    rows: Report[];
    has_more: boolean;
    next_cursor: { created_at: string; id: string } | null;
  };
  return (
    <Shell
      admin={admin}
      active="/reports"
      title="Seller review reports"
      sub="Investigate verified purchase reviews. Every decision requires a reason and is recorded in the audit log."
    >
      <nav className="mb-5 flex gap-4">
        <Link href="/reports" className="underline">
          Reports desk
        </Link>
        <Link href="/market/reviews" className="underline">
          Open reports
        </Link>
        <Link href="/market/reviews?status=all" className="underline">
          All reports / restore reviews
        </Link>
      </nav>
      {!page.rows.length && (
        <p className="rounded-xl border border-[var(--line)] p-6">
          No review reports on this page.
        </p>
      )}
      <div className="space-y-4">
        {page.rows.map((report) => (
          <article
            className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5"
            key={report.id}
          >
            <div className="flex flex-wrap gap-3 text-sm">
              <strong>{report.reason.replaceAll("_", " ")}</strong>
              <span>
                {report.status} · review {report.moderation_status || "deleted"}
              </span>
              <time dateTime={report.created_at}>
                {new Date(report.created_at).toLocaleString("en-GB", {
                  timeZone: "UTC",
                })}{" "}
                UTC
              </time>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm">
              Report details: {report.detail || "None supplied."}
            </p>
            {report.current_version &&
              report.current_version !== report.review_version && (
                <p className="mt-3 text-sm">
                  This review was edited after the report. Review the current
                  content below before deciding.
                </p>
              )}
            <blockquote className="my-4 border-l-2 border-[var(--line)] pl-4">
              {report.review_id && <strong>{report.rating} / 5 stars</strong>}
              <p className="whitespace-pre-wrap break-words">
                {report.review_id
                  ? report.comment || "(Rating only)"
                  : "This review was deleted. Its report remains available for staff resolution."}
              </p>
            </blockquote>
            <div className="flex flex-wrap gap-4 text-sm">
              {report.reviewer_id && (
                <Link
                  className="underline"
                  href={"/users/" + report.reviewer_id}
                >
                  Reviewer
                </Link>
              )}
              {report.seller_id && (
                <Link className="underline" href={"/users/" + report.seller_id}>
                  Seller
                </Link>
              )}
              {report.reporter_id ? (
                <Link
                  className="underline"
                  href={"/users/" + report.reporter_id}
                >
                  Reporter (staff only)
                </Link>
              ) : (
                <span>Reporter account deleted</span>
              )}
              {report.order_id && (
                <span>Verified order: {report.order_id}</span>
              )}
            </div>
            {(report.status === "open" ||
              report.moderation_status === "hidden") && (
              <CommandForm
                action={moderateReview}
                scope={"seller-review:" + report.id}
                className="mt-4 flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="report_id" value={report.id} />
                <input
                  type="hidden"
                  name="content_version"
                  value={report.current_version || 0}
                />
                <label className="flex-1 text-sm">
                  Decision reason
                  <textarea
                    required
                    minLength={3}
                    maxLength={1000}
                    name="reason"
                    rows={2}
                    className="mt-1 block w-full min-w-48 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3"
                  />
                </label>
                {report.status === "open" && (
                  <>
                    <button
                      name="decision"
                      value="dismiss"
                      className="rounded-lg border border-[var(--line)] px-4 py-3"
                    >
                      Dismiss report
                    </button>
                    {report.moderation_status === "visible" && (
                      <button
                        name="decision"
                        value="hide"
                        className="rounded-lg border border-[var(--line)] px-4 py-3"
                      >
                        Remove review
                      </button>
                    )}
                  </>
                )}
                {report.moderation_status === "hidden" && (
                  <button
                    name="decision"
                    value="restore"
                    className="rounded-lg border border-[var(--line)] px-4 py-3"
                  >
                    Restore review
                  </button>
                )}
              </CommandForm>
            )}
          </article>
        ))}
      </div>
      {page.has_more && page.next_cursor && (
        <Link
          className="mt-5 inline-block underline"
          href={
            "/market/reviews?" +
            new URLSearchParams({
              status,
              before: page.next_cursor.created_at,
              id: page.next_cursor.id,
            })
          }
        >
          Older reports
        </Link>
      )}
    </Shell>
  );
}
