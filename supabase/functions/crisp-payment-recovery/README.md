# Chat payment recovery

This worker reconciles existing pending chat payment records against Crisp's
partner-authorised `GET p2p-status` endpoint. It never submits or retries a debit.
A canonical `not_found` remains pending because the original call may be delayed.

## Configuration

- Apply `20260910230211_chat_payment_recovery.sql` to an isolated test database first.
- Use a sandbox Crisp partner key in server-only `CRISP_API_KEY`.
- `CRISP_API_URL` must explicitly point at the intended environment. There is no
  hosted fallback. Use a localhost Crisp emulator during local testing.
- The worker requires the exact legacy project service-role JWT in the
  `Authorization: Bearer ...` header. Leave the platform JWT verification enabled.
  Ordinary user sessions and the anonymous project key cannot invoke recovery.
- A future switch to opaque Supabase secret keys requires the corresponding
  documented service authentication configuration. Do not disable platform JWT
  verification on this legacy-token endpoint to make a different key work.

No schedule, hosted credentials, deployment or external payment delivery is
created by this change. An authorised operator can invoke POST after isolated
validation. The default batch is 20 records, the maximum is 50, and the handler
stops beginning new checks after 20 seconds. Each provider request has a 7-second
timeout. Work less than 60 seconds old or checked in the last 60 seconds is skipped.

Results contain counts only: `checked`, `completed`, `pending`, `errors` and
`remaining_in_batch`. Nonzero errors mean lookup or persistence could not be
verified. They do not prove the underlying payment failed. Inspect pending work
through authorised operations tools. Never replace its original payment identity
or resend money to resolve an uncertain outcome.

## Local validation

Run `node --test supabase/tests/chat-payment-recovery.test.ts` with Node 22.18+
or Node 24. This exercises the actual HTTP handlers with mocked PostgREST and
provider responses, including a committed debit whose response is lost.

Run the database test using PGlite 0.3.14 installed in isolated validation tools:
`TRINITI_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test supabase/tests/chat-payment-recovery-db.test.mjs`.
It runs the migration on embedded PostgreSQL, verifies owner-scoped reads and
rejected client writes, and checks the pending-work index and ordering.

These tests do not certify a hosted deployment, installed-device authentication,
bank connectivity or live payment readiness.

## Record and receipt protection

The migration prevents conversation deletion from cascading into payment records.
It also prevents explicit deletion or truncation of those records, including user
account deletion helpers. Accounts with payment history require a reviewed
retention and anonymisation process. This change does not invent that process or
claim a legally required retention period.

Receipt messages carry a server-protected `payment_receipt_verified` flag. Clients
must filter that flag when loading a payment card. Ordinary messages remain
editable. Clients cannot create, edit or delete payment receipt messages, including
through a user-invoked security-definer helper. The recipient may update only the
existing read, viewed and delivery timestamps. Legacy messages are verified only
when their fields match a completed canonical payment record. Conflicting verified
duplicates fail the migration for review instead of being deleted.

Recovery only finalises responses with the exact payment reference, amount and
currency and a UUID transaction reference. A saved intent whose original outbound
call never reached Crisp remains pending on `not_found`. It needs reconciliation,
not an automatic new debit. The worker does not silently release that identity.
