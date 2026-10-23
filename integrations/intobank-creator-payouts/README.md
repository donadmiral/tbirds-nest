# IntoBank provider contract review

Reviewed 2026-10-23 against `donadmiral/Intobank`, branch `claude/prefunded-rail`, commit `f312569d337b7d6409166170a392d1fd60e05bed`, crisp-api blob `d8ff3c6dfa2843e68b91641e38e8459b5d9c14de`, and read-only deployed SQL inspection of project `owvusgpsfcrqrytocajo`.

This directory preserves a reviewed draft and tests, not a deployable creator payout integration. Do not deploy it as a new payout capability or include its SQL in Platinum migrations.

## Confirmed provider change

The deployed `public.triniti_network_command` contains the Part-43 bank-model admission check. A new `partner_payout` raises `BANK_PAYMENT_REQUIRED`. Existing keys retain their original payload-bound replay behavior.

`public.triniti_bank_payment_command(actor, key, payload)` is the replacement customer bank-payment command. It requires the actual user's owned, active, consented, verified `connection_id`, a verified `beneficiary_id`, and source/provider payment permission. Current code accepts only simulated domestic SIM-ZW-A/C connections and DEMOBANKA/C destinations. Live financial rails are not enabled by a test key.

The bank connection schema supports `personal`, `group_mandate` and `payout_mandate` purposes. Non-personal connections require the matching mandate reference inside `bank_payment_create`; the public customer wrapper supplies no mandate. The partner schema has no approved source bank connection/mandate binding. Consequently neither a wallet link nor a partner API key authorizes debiting a user's personal bank connection for creator payouts.

## Preserved draft

`legacy-receipt.sql` defines a canonical, partner-bound read of historical network instructions. It requires a posted journal and provider confirmation before reporting same-bank recipient credit; prefunded rail settlement alone is not recipient credit. A no-send result requires a released reservation and no journal or settlement. It recovers old missing partner references only through the immutable partner command result.

`payoutContract.ts` preserves exact decimal strings and binds the future payout payload reference to its idempotency key. It must not be wired to a new dispatch route until a real partner bank-source mandate contract exists. Replaying historical keys with a changed payload would fail idempotency checks; use canonical receipt lookup for historical recovery.

The local tests use a synthetic PostgreSQL schema and no bank requests. Run from the Platinum repository:

```sh
node --test integrations/intobank-creator-payouts/partner-payout-receipt.test.cjs
```

Before a live adapter can be enabled it needs an explicit partner bank-source mandate, verified recipient-bank mapping, scope and limits, canonical payment/credit/no-movement receipts, revocation rules, and separate test/live credentials and approval. The existing bank-model guard must remain intact.
