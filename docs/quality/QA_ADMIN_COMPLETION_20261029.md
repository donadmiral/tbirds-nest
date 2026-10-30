# Isolated QA admin forward upgrade — 29 October 2026

The existing QA project `uaulhuelcfkjwojtymmw` is accessible through the SQL connector. Its inspected catalog already contains the three central admin contracts and their private tables, so the production candidate correctly refuses to overwrite it. This separate forward candidate handles that exact QA state without removing or weakening the production collision guard.

## Candidate and scope

- File: `supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql`
- SHA256: `6b12d607dfeb999708351819dce164e4355374b05edf3d6c2029fb097e73c463`
- Target: only the reviewed existing QA catalog. The file is deliberately outside `supabase/migrations` and must not be included in a production `db push`.
- Production completion source remains unchanged at SHA256 `22eaa117a397c5973055f9e1c6f4c612328e93cbf7438e0e37e82e068f051cbc`.

The delta replaces six existing function definitions: general admin commands, provisioning, the removed-content guard, evidence URL validation, support-triage reading, and support-triage updates. It brings support capability reporting and assignee-row locking to the current implementation. It also removes unnecessary direct execution grants from three comment-count trigger functions. Service-only command grants and private trigger-helper grants remain explicit.

No table, row, bucket setting, account, session, staff role, existing receipt, or retention request is created, reset, or deleted by this migration. QA's single-owner governance table, functions, and triggers remain intact, as does its original support-assignee foreign key behavior. Finance, music, and provider configuration are outside this delta.

## Exact-state protection and validation

The transactional preflight checks all **22** inspected admin/support/trigger definitions and their execution ACLs, plus a fingerprint of all six private table contracts, indexes, constraints, policies, and ten associated guard triggers. Drift aborts before the first replacement. The three-second lock timeout bounds migration lock waits. A repeated apply also aborts against the changed definitions rather than silently overwriting them.

`QA_ADMIN_BASELINE_20261029.json` contains schema metadata and counts only. It contains no hosted account rows, credentials, or media paths. A fresh read immediately before handoff still matches the captured baseline: **1 Auth user, 1 staff row, 1 profile, and 15 Storage objects**.

The local fixture reconstructs the tested production/parity chain, then overlays the exact QA catalog. It uses independently generated synthetic records with the same counts, an existing receipt, and a single-owner policy row. The forward upgrade leaves those records and unrelated function/configuration state byte-for-byte equivalent. PostgreSQL's newer NOT NULL constraint catalog entries are excluded from the constraint-array comparison because column nullability is already checked explicitly; this avoids a PostgreSQL 17/18 catalog representation mismatch without weakening that check.

The QA path passes **36 behavioral database cases**, including the same 34 command/provisioning/moderation/verification/session tests as the production candidate and two additional unexpected-grant/schema rejection cases. The production path was rerun independently and passes **34/34**. Final definitions match the reviewed production completion and support contracts. The exact local postflight catalog is retained in `QA_ADMIN_COMPLETION_GATE_20261029.json`.

Run the gate:

```bash
ADMIN_COMPLETION_CATALOG_OUTPUT=/tmp/platinum-qa-admin-completion-catalog.json node supabase/tests/rpc-authorization/test-qa-admin-completion-chain.mjs
```

The suite is registered in the full RPC authorization runner. It does not replace hosted Auth reserve/create/finish acceptance, a real staff browser session, or multi-connection race testing.

## Apply and verify

The release owner should read `supabase/ops/check-qa-admin-completion-preflight.sql` against the QA project and compare it with the baseline, apply only the exact candidate SHA above, then run that same catalog query and compare it with `qaCatalog` in the gate receipt. The candidate itself independently enforces the preflight. The postflight must retain the existing counts, table contracts, native-session hash, and QA single-owner governance definitions while showing the six new function definitions and three tighter trigger-function ACLs.

No hosted mutation or TestFlight action was performed by this lane. The protected QA preview is the next place to exercise the actual staff journeys and provider provisioning.
