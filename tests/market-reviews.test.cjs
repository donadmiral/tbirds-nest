const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getSellerReviewPage,
  submitSellerReview,
  reportMarketContent,
  reviewError,
} = require("../shared/marketReviews.ts");
function client(result = { data: "confirmed", error: null }) {
  const calls = [];
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args });
      return {
        abortSignal(signal) {
          assert.ok(signal instanceof AbortSignal);
          return Promise.resolve(result);
        },
      };
    },
  };
}
test("review writes bind the expected account and canonical completed order, never caller-chosen seller/listing", async () => {
  const c = client();
  await submitSellerReview(c, "buyer", "order", 4, "  Good purchase  ");
  assert.deepEqual(c.calls[0], {
    name: "submit_seller_review",
    args: {
      p_expected_user: "buyer",
      p_order_id: "order",
      p_rating: 4,
      p_comment: "Good purchase",
    },
  });
});
test("read requests carry complete cursor and bounded page size", async () => {
  const c = client();
  await getSellerReviewPage(c, "seller", "listing", {
    created_at: "date",
    id: "id",
  });
  assert.deepEqual(c.calls[0], {
    name: "seller_review_page",
    args: {
      p_seller_id: "seller",
      p_listing_id: "listing",
      p_before_at: "date",
      p_before_id: "id",
      p_limit: 20,
    },
  });
});
test("review and listing reporting use distinct checked RPCs with expected user", async () => {
  const c = client();
  await reportMarketContent(
    c,
    "reporter",
    "review",
    "id",
    "fake",
    "  details ",
  );
  await reportMarketContent(c, "reporter", "listing", "listing", "scam", "");
  assert.deepEqual(c.calls[0], {
    name: "report_seller_review",
    args: {
      p_expected_user: "reporter",
      p_review_id: "id",
      p_reason: "fake",
      p_detail: "details",
    },
  });
  assert.equal(c.calls[1].name, "report_market_listing");
  assert.equal(c.calls[1].args.p_listing_id, "listing");
});
test("missing confirmation and database failures reject, with safe user-facing error messages", async () => {
  await assert.rejects(
    () =>
      submitSellerReview(
        client({ data: null, error: null }),
        "buyer",
        "order",
        3,
        "",
      ),
    /UNAVAILABLE/,
  );
  await assert.rejects(
    () =>
      getSellerReviewPage(
        client({ data: null, error: { message: "Database internals" } }),
        "seller",
      ),
    /Database internals/,
  );
  assert.equal(
    reviewError(new Error("Database internals")),
    "This request could not be confirmed. Please retry.",
  );
  assert.match(
    reviewError(new Error("REVIEW_UNDER_MODERATION")),
    /support to appeal/,
  );
  assert.match(reviewError(new Error("ACCOUNT_CHANGED")), /account changed/);
});
