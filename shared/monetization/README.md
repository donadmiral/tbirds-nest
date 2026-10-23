# Creator finance and commerce

IntoBank is the primary provider. Financial values are exact decimal strings of USD minor units; PostgreSQL bigint and integer allocation avoid floating-point money arithmetic.

## Implemented

- Authenticated web and phone creator screens show real program state, recorded balances, payout outcomes, product drafts, purchases, paid access periods and refund balances. Missing services remain visibly unavailable rather than appearing as zero earnings.
- Enrollment requires current server terms and staff approval. Finance reviews require an active finance-role admin session at native aal2, matching row revision, reason and idempotency key. Each decision creates one audit record.
- Payouts reserve funds atomically, freeze recipient and provider, retain unknown amounts, and reconcile canonical receipts. Expiring leases recover crashed workers. A dispatch intent prevents duplicate sending; recovery performs a status read. Pausing new payouts does not pause existing money reconciliation.
- Phone payout requests persist their idempotency key and amount before sending. Uncertain responses retry that exact request. Web directs the user to the phone for payouts.
- Immutable revenue policy version 2026-10-v1 allocates eligible net revenue: ads 55%, subscriptions 90%, gifts 70%, sponsorships 90%, marketplace 95% to the creator. Genuine tips allocate 100% with no deducted fee. These rates do not promise earnings. Any future version needs a separately published policy.
- Creator product drafts support prepaid subscriptions, genuine tips and digital gifts. Orders freeze creator, price, currency and access period; account changes and self-purchases are rejected. Settlement is service-only and atomically writes the receipt, policy allocation, ledger credit and subscription period.
- Fully refunded subscriptions lose their paid access. Partial refunds calculate cumulative creator reversals without rounding drift. Refunds after money has been paid create a visible receivable, preserve paid history, block new withdrawals and offset future earnings. No client can mark its order paid or grant an entitlement.
- Subscription access is checked on the server for the requesting user and current paid period. It restores across devices through authenticated reads. These are prepaid periods; automatic renewal is explicitly unavailable.
- Historical finance references retain auth identities. Coordinated account erasure must deactivate accounts and revoke access while retaining financial records for the applicable retention policy.

## Provider verification and release boundary

Read-only inspection on 2026-10-23 confirmed that the current IntoBank branch is `claude/prefunded-rail` at `f312569d337b7d6409166170a392d1fd60e05bed`. Its canonical instruction fields support receipt binding. The proposed receipt/reference patch is a separate integration candidate, not a deployed provider capability.

The deployed bank model now rejects new legacy `partner_payout` commands with `BANK_PAYMENT_REQUIRED`. Its replacement `triniti_bank_payment_command` requires a consented owner bank connection and verified beneficiary, and currently only permits simulated domestic bank routes. It is not a partner-funded creator disbursement contract. There is no configured partner bank source/mandate binding in this integration. Do not enable creator payouts by setting a database flag, fabricate a wallet payout, reuse a person's bank consent, or claim live bank access.

Both payouts and purchases start disabled. `provider_dispatch_ready()` is deliberately false for the unsupported current partner contract, so changing stale provider flags cannot advertise or start new payouts. Commerce settlement/refund functions accept test-environment orders only and are not exposed as customer-facing capture APIs. No live purchase capture, automatic recurring mandate, store billing, digital-goods billing exception, tax approval or verified destination setup is inferred from a wallet link. Completing the real bank-source/mandate and applicable app-store contracts is required before enabling those capabilities. The live UI never presents sandbox money as live earnings.

## Migration order

1. `20261022173111_creator_monetization_foundation.sql`
2. `20261022211313_creator_finance_operations.sql`
3. `20261022211400_creator_product_entitlements.sql`
4. `20261022211649_creator_finance_review.sql` (requires the existing admin session check, native auth.sessions and admin audit schema)
5. `20261023190254_creator_finance_dispatch_and_refund_guards.sql` (forward-only readiness, refund and recovery hardening)

The product migration must precede `20261022211648_content_media_manifests.sql`, which calls `creator_has_active_subscription`.

## Verification

- `node --test tests/creator-monetization.test.cjs tests/creator-payout-worker.test.cjs web/tests/monetization-quality.cjs`
- `node --test supabase/tests/creator-finance-operations.test.cjs supabase/tests/creator-commerce.test.cjs`
- `node --test supabase/tests/creator-monetization-db.test.cjs` covers the original ledger foundation.

The database suites execute the production SQL in isolated PGlite with synthetic roles, users and funds. Tests first verify that production dispatch is blocked; a database-owner-only synthetic capability then exercises the future payout state machine. They prove transaction and authorization behavior, not bank execution, physical-device acceptance or production capacity. Provider receipts have their own isolated contract tests. Current live bank readiness was inspected without financial mutations.
