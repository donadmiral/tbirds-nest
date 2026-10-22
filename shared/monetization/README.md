# Creator monetization foundation

IntoBank is the primary provider. This feature is deliberately not wired to the existing member-to-member Crisp payment operation. That operation does not define a creator funding source, approved beneficiary or payout settlement contract.

## Implemented contract

- `/monetization` and native `MonetizationScreen` display the authenticated member's program state, live IntoBank link status, recorded balances, recent ledger movements and payout outcomes.
- A successful empty overview says no earnings have been recorded. A missing migration, outage or malformed response says unavailable and never substitutes zero earnings.
- Session, overview, link and enrollment waits have UI deadlines. A timed-out enrollment is unconfirmed, not cancelled. Account changes clear displayed financial data and ignore late responses from the previous account.
- Register interest is real, caller-bound and idempotent. An application additionally requires the current server-specified terms. Interest does not confer eligibility or an earnings promise. Enrollment starts closed.
- Money is held as PostgreSQL `bigint` minor units and transported as decimal strings. USD is the only funded-earning currency enabled in this version. No arithmetic uses floating point.
- Private tables and narrow caller-bound invoker wrappers isolate records. Clients cannot write balances, provider capability, verification, approval or settlement.
- Every balance change is an immutable ledger movement. A replayed key must match the original owner, currency, amount, buckets and source reference. Adjustments are additional entries, not history edits.
- Payout requests require approval, enabled provider/currency and an independently verified payout account. They freeze the provider and destination and atomically move available funds to reserved funds. Unknown results stay reserved.
- Trusted reconciliation binds provider/event/reference, payout ID, frozen account, amount and currency. Verified completion moves reserved to paid. A provider-confirmed no-movement rejection restores available funds. Contradictory terminal outcomes are rejected for investigation.
- Provider-specific code is isolated in `provider.ts`. The current IntoBank adapter cannot submit or claim completion, and an unknown provider never becomes an implicit fallback.

## Not enabled by this migration

No test balances, earnings formula, take rate, eligibility threshold, paid subscription, creator fee or live transfer is created. Payout capability starts disabled and no payout execution worker/endpoint is installed. The UI does not offer a transfer control before that integration exists.

A release enabling payouts needs the approved IntoBank funding/disbursement contract, account verification, payload-bound provider idempotency, canonical settlement/no-movement receipts and reconciliation schedule. It also needs approved program terms/eligibility, funding attribution, finance approval roles, tax/identity requirements where applicable, support/appeals and retention/deletion handling. Historical financial records currently prevent deleting their referenced auth user; do not enable earnings in production until the coordinated account-retention contract is installed. Interest-only accounts can be deleted normally.

`creator_finance.record_funded_earning`, `move_earning` and `reconcile_payout` are private service-role entry points for a future verified server adapter. A typed reference alone is not proof of funding: no unverified caller-facing endpoint is provided. The migration leaves provider and approval configuration restricted to database ownership, pending reviewed operational commands.

## Verification

- `node --test tests/creator-monetization.test.cjs` executes the production domain, provider and client contracts.
- `node --test web/tests/monetization-quality.cjs` executes the web authentication lifecycle, including failures, late sessions, account changes and unmounts.
- `PGLITE_MODULE=/path/to/@electric-sql/pglite node --test supabase/tests/creator-monetization-db.test.cjs` executes the real migration and functions in an isolated PostgreSQL runtime with synthetic roles/users/funds. It covers direct-access denial, owner binding, current terms, integer precision, immutable history, matching replay, guarded reservation, unknown outcomes and terminal reconciliation.
- These tests do not establish real provider outcomes, cross-connection load or browser/device acceptance. The migration was applied to the isolated Platinum QA project on 2026-10-22. Production rollout remains separate.
