export type ReviewCursor = { created_at: string; id: string };
export type SellerReview = {
  id: string;
  order_id: string;
  reviewer_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  } | null;
};
export type ReviewOrder = {
  id: string;
  title: string;
  completed_at: string;
  rating: number | null;
  comment: string | null;
  moderation_status: "visible" | "hidden" | null;
};
export type ReviewPage = {
  rows: SellerReview[];
  has_more: boolean;
  next_cursor: ReviewCursor | null;
  summary: {
    avg_rating: number;
    review_count: number;
    five: number;
    four: number;
    three: number;
    two: number;
    one: number;
  };
  eligible_orders: ReviewOrder[];
};
export const REVIEW_REASONS = [
  { key: "fake", label: "Fake or dishonest review" },
  { key: "harassment", label: "Harassment or abuse" },
  { key: "private_information", label: "Private information" },
  { key: "irrelevant", label: "Spam or unrelated content" },
  { key: "other", label: "Something else" },
] as const;
export const LISTING_REASONS = [
  { key: "scam", label: "Scam or fraud" },
  { key: "prohibited", label: "Prohibited item" },
  { key: "misleading", label: "Misleading listing" },
  { key: "inappropriate", label: "Inappropriate content" },
  { key: "duplicate", label: "Spam or duplicate" },
  { key: "other", label: "Something else" },
] as const;
type Client = { rpc: (name: string, args: Record<string, unknown>) => any };
async function request(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const { data, error } = await client
      .rpc(name, args)
      .abortSignal(controller.signal);
    if (error || data == null) throw new Error(error?.message || "UNAVAILABLE");
    return data;
  } finally {
    clearTimeout(timer);
  }
}
export function reviewError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    COMPLETED_PURCHASE_REQUIRED:
      "Only the buyer of a completed order can review this seller.",
    ACCOUNT_CHANGED: "Your account changed. Sign in again before continuing.",
    REVIEW_UNDER_MODERATION:
      "This review was removed by moderation. Contact support to appeal.",
    REVIEW_UNAVAILABLE: "This review is no longer available.",
    LISTING_UNAVAILABLE: "This listing is no longer available.",
    INVALID_REVIEW:
      "Choose one to five stars and use no more than 2,000 characters.",
  };
  return messages[code] || "This request could not be confirmed. Please retry.";
}
export async function getSellerReviewPage(
  client: Client,
  seller: string,
  listing?: string | null,
  cursor?: ReviewCursor,
): Promise<ReviewPage> {
  return request(client, "seller_review_page", {
    p_seller_id: seller,
    p_listing_id: listing || null,
    p_before_at: cursor?.created_at || null,
    p_before_id: cursor?.id || null,
    p_limit: 20,
  });
}
export async function submitSellerReview(
  client: Client,
  user: string,
  order: string,
  rating: number,
  comment: string,
): Promise<string> {
  return request(client, "submit_seller_review", {
    p_expected_user: user,
    p_order_id: order,
    p_rating: rating,
    p_comment: comment.trim(),
  });
}
export async function reportMarketContent(
  client: Client,
  user: string,
  kind: "review" | "listing",
  id: string,
  reason: string,
  detail: string,
): Promise<string> {
  return request(
    client,
    kind === "review" ? "report_seller_review" : "report_market_listing",
    {
      p_expected_user: user,
      [kind === "review" ? "p_review_id" : "p_listing_id"]: id,
      p_reason: reason,
      p_detail: detail.trim(),
    },
  );
}
