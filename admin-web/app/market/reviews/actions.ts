"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/adminAuth";
import { serviceClient } from "@/lib/supabaseAdmin";
import { isMissingAdminRpc } from "@/lib/adminRpcAvailability";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function moderateReview(data: FormData) {
  const admin = await requirePermission("report_listing");
  const key = String(data.get("command_key") || "");
  const id = String(data.get("report_id") || "");
  const action = String(data.get("decision") || "");
  const version = Number(data.get("content_version") || 0);
  const reason = String(data.get("reason") || "").trim();
  if (
    !Number.isInteger(version) ||
    version < 0 ||
    !UUID.test(key) ||
    !UUID.test(id) ||
    !["hide", "dismiss", "restore"].includes(action) ||
    reason.length < 3 ||
    reason.length > 1000
  ) {
    return {
      success: false,
      error: "Choose a decision and explain the reason in 3–1,000 characters.",
    };
  }
  const { error } = await serviceClient().rpc("moderate_seller_review", {
    p_actor_id: admin.id,
    p_session_id: admin.sessionId,
    p_key: key,
    p_report_id: id,
    p_expected_version: version || null,
    p_action: action,
    p_reason: reason,
  });
  if (isMissingAdminRpc(error, 'moderate_seller_review')) {
    return { success: false, error: 'Review decisions are unavailable on this deployment. No review was changed. Contact the platform administrator.' };
  }
  if (error)
    return {
      success: false,
      error:
        "The decision could not be confirmed. Refresh to check the current state, then retry.",
    };
  revalidatePath("/market/reviews");
  revalidatePath("/reports");
  return { success: true, message: "Decision saved in the audit record." };
}
