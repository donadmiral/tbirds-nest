# Admin operations completion — 29 October 2026

## Result and deployment state

The three remaining admin contracts now have a forward migration, exact deployed-schema tests, and matching server response validation. **The 34 database cases and 16 server command/provisioning cases pass with no failures or skips.** This lane made no production mutation, created no hosted Auth identity, sent no message, and performed no real account deletion. TestFlight remains held.

The candidate is `supabase/migrations/20261029224550_admin_operations_completion.sql`, generated with the available official Supabase CLI's `migration new` command. Its SHA256 is:

```text
22eaa117a397c5973055f9e1c6f4c612328e93cbf7438e0e37e82e068f051cbc
```

`ADMIN_COMPLETION_GATE_20261029.json` records the exact candidate, test names, local postflight definitions and privileges, preserved contracts, and remaining acceptance. This is a source-completion receipt, not evidence that the candidate is installed on production.

## Installed contracts and behavior

| Service-only contract | Completed behavior |
| --- | --- |
| `triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)` | 33 existing admin actions across verification, restrictions, content/report moderation, support replies/status, campaign review, staff governance, system controls, business rejection, organization ownership/archive, and retention-review deletion requests. |
| `triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)` | Two-phase staff and business setup: reserve a fresh identity, create it through the server-only Auth Admin API, then finish only the exact reserved identity and reviewed application. |
| `triniti_admin_deletion_requests(uuid,uuid,integer)` | Super-admin-only retention-review queue with stable order, a 50-row page size, and page bounds of 1–10,000. |

The migration expands the existing session validator to the same 15 permissions used by all 11 frontend staff roles. It preserves valid AAL1/AAL2 sessions, the unchanged native session helper, actor/session ownership, expiration, deletion, bans, and current active-role checks. Unknown permissions fail closed. Current role and session checks run before returning an existing command receipt.

App callers receive no execute privilege for the three APIs. The private `commands`, `support_triage`, `provisions`, `deletion_requests`, and `removals` tables have RLS and deny direct app-role and service-role reads and writes. The public API functions execute through the protected admin server. All newly installed or replaced functions have an empty search path and use qualified application relations.

The four deployed support assignment/review functions keep their exact definitions and ACLs. Their existing `support_commands_available` discriminator automatically becomes true when the central command's exact signature and service execution privilege are installed. No new mutating capability probe or permissive fallback is introduced.

### Commands, audit, and staff governance

Each command binds its UUID replay key to the acting staff identity, operation, and exact payload. Identical retries return the saved result; changed details, another operation, or another actor cannot reuse the receipt. The business change, audit insert, and result receipt commit together. The tests deliberately fail audit insertion and verify rollback before retrying the same command successfully.

Staff-sensitive changes use the existing advisory-lock order before actor row locks. Deactivation cannot remove the last active super administrator. Active staff identities must first go through the staff desk before suspension, strikes, or a deletion request. Suspension and staff deactivation revoke native sessions. Every subsequent operation reads the current role rather than relying on an old role embedded in the request.

Report actions verify the report's target and open state. Campaign approval follows the permitted review state without manufacturing funding or changing payment records. Organization archive revokes actual delegations; ownership transfer verifies and locks the active, nondeleted, nonbanned destination identity before changing memberships.

### Persistent moderation and verification

Content removals are captured from the same atomic audit insert. Existing valid removal audit records are backfilled into the private removal register. Owners cannot restore a moderated listing, erase its retained row, or reuse a removed post, story, comment, or listing ID. A forged JWT role under an actual app database role does not bypass the guard. Listing history remains available for retained order relationships.

The deployed comment table uses multiple existing count triggers. Three of those trigger bodies relied on an inherited search path. The migration verifies their exact deployed hashes, qualifies the same table references, and assigns an empty search path. It does not replace their counting algorithm. A real synthetic comment insertion and moderation deletion finish with counts of one and zero respectively.

Verification evidence is private to the applicant; staff inspect it through the protected admin server. Applicants cannot set verification flags or decisions themselves, submit another user's application, create duplicate pending applications, or alter a verified identity's name, username, or account type through a client write. Approval checks evidence, account type, an available profile, an independent reviewer, and a recorded decision. Revocation updates previously approved applications to `revoked` with a timestamp.

| Validation | Bounds or rule | Error code |
| --- | --- | --- |
| Approval review basis | Trimmed 20–2,000 characters; reviewer cannot be the applicant | `VERIFICATION_REVIEW_BASIS_REQUIRED` |
| Verification statement | Trimmed 20–2,000 characters | `VERIFICATION_STATEMENT_REQUIRED` |
| Evidence links | 1–8 HTTP(S) links; each at most 2,048 characters; no credentials, whitespace, control characters, or backslashes | `VERIFICATION_EVIDENCE_LINK_REQUIRED`, `VERIFICATION_EVIDENCE_URL_INVALID` |
| Category | Trimmed 2–120 characters | `VERIFICATION_CATEGORY_REQUIRED` |
| Official office | Trimmed 3–200 characters for the official tier | `VERIFICATION_OFFICE_REQUIRED` |
| Account type | Business tier matches a business account | `VERIFICATION_ACCOUNT_TYPE_MISMATCH` |
| Rejection reason | Nonempty and at most 2,000 characters in SQL; matching queue UI asks for 20–2,000 | `REASON_REQUIRED` |
| Existing decision | Approval requires a submitted or under-review application | `APPLICATION_NOT_PENDING`, `VERIFICATION_DECISION_FINAL` |

The release owner's companion queue UI adds the required approval/rejection textarea and review-basis guidance. `adminCommand.ts` now turns the principal verification failure codes into actionable staff-facing copy instead of a generic retry message.

### Provider provisioning

Staff provisioning reserves a fresh Auth identity for an unused email and the intended role. Only a password HMAC reaches the database; the password goes directly from the protected server to the provider API. The completion step requires the reserved UUID, normalized email, trusted `app_metadata.triniti_provision_id`, a nondeleted Auth record, and a staff identity that has not been banned. Only then does it grant a staff role and write the audit result.

Business identities use an independently generated nondeliverable login address, preserving the owner's personal email and Auth identity. The owner receives delegated membership; the business identity is banned from direct sign-in after completion. Both reservation and completion require an active owner with a nondeleted, nonbanned Auth record. Completion rechecks all six reviewed fields: applicant, normalized username, company name, category, description, and normalized contact email. An edited application cannot acquire a verified identity under an earlier review.

The server helper validates complete reservation and completion receipts. An incomplete or wrong-key reservation stops before any provider account creation. A mismatched finish response cannot be displayed as success. An identity without trusted reservation metadata produces a review error rather than a JavaScript exception. Network/provider uncertainty preserves the same form details and replay key so the original reservation can be resumed safely.

Five database cases and three server cases failed before these final integrity changes and pass after them. The fifth database regression proves rejection of backslash-containing evidence links after correcting an inherited SQL LIKE escape bug. These tests exercise the failure behavior rather than only checking that the source contains particular strings.

### Deletion retention

The admin deletion action requires an explicit `DELETE` confirmation and a reason, rejects active staff and accounts that still own an organization or business, bans the Auth identity, clears the push token, and revokes sessions. It retains Auth and financial records and creates a `retention_review` request. A subsequent ordinary restore cannot bypass that review.

This queue does not claim that stored-file erasure is complete. It remains separate from the self-service Storage-erasure worker being implemented in the media/privacy lane. Connecting a reviewed admin retention decision to physical erasure requires an explicit retention policy and acceptance, rather than silently deleting financial or moderation records.

## Exact baseline and safety checks

The local database chain reconstructs the 18 production and seven parity units from their reviewed manifests and verifies every listed source SHA256. It then applies only the four already-deployed quality fixes: applicant self-service, author comment highlights, redacted diagnostics, and the narrow support/review restoration.

Before applying this candidate, the local catalog is deep-equal to fresh read-only production metadata, including 212 required columns, constraints and policies, full prerequisite function definitions and privileges, the two existing private admin tables, and absence of the target contracts and guard triggers. The checked-in receipt is `ADMIN_COMPLETION_PREFLIGHT_20261029.json`.

The candidate's own transactional preflight aborts if any target contract or private target table is already present, if the existing namespace is missing, or if any of its five exact prerequisite function hashes has drifted. A three-second lock timeout avoids an unbounded migration lock wait. The candidate emits PostgREST's schema reload notification inside the transaction.

The preservation test compares unrelated public/Auth/Storage/finance functions and ACLs, bucket settings, music state, finance program/provider configuration, database roles, staff rows, Auth identities, profiles, and native sessions. The four narrow support/review definitions and native session-check hash remain unchanged.

## Validation and remaining acceptance

| Gate | Verified result |
| --- | --- |
| Exact production + parity + four-repair + candidate database suite | 34 passed; zero failed or skipped |
| Server command/provisioning contract suite | 16 passed; zero failed or skipped |
| Standalone admin TypeScript | No diagnostic errors |
| Whole-worktree whitespace check at handoff | Clean |
| Production apply, real Auth creation, support messages, real deletion | Not performed by this lane |

Run the database suite from the repository root:

```bash
ADMIN_COMPLETION_CATALOG_OUTPUT=/tmp/platinum-admin-completion-catalog.json node supabase/tests/rpc-authorization/test-admin-completion-chain.mjs
```

Run the server contract suite from `admin-web`:

```bash
node tests/command-contracts.cjs
```

The database suite is registered in `supabase/tests/rpc-authorization/run-all.mjs`, alongside the separate account-erasure and private-media suites. The suite uses the actual reconstructed session helper and database privileges, with hostile app roles and forged claims. Local Auth/Storage fixtures do not replace a hosted provider test; PGlite executes through one connection and does not demonstrate multi-backend lock contention behavior.

Before a release apply, run the combined candidate chain in isolated QA, repeat `supabase/ops/check-admin-completion-preflight.sql` against the actual deployment target, compare it with the reviewed receipt, and apply only this exact migration SHA. Then run `supabase/ops/check-admin-completion-postflight.sql` and compare all definitions, privileges, triggers, the capability value, and preserved hashes with the gate.

The remaining intentional acceptance is a hosted staff-session/browser walkthrough, actual Auth Admin reserve/create/finish and retry behavior using approved disposable identities, and concurrent staff-governance/provisioning requests on a multi-connection database. This work does not validate unrelated device, messaging, payment, or media-provider behavior and does not lift the TestFlight hold.

## Official references checked

The current Supabase changelog and relevant entries were checked before creating the migration. The current Postgres extension changes and deprecated CBC TLS ciphers do not change these SQL contracts. Function privilege and search-path choices follow [Supabase's Database Functions guidance](https://supabase.com/docs/guides/database/functions). Auth account creation remains server-only as documented in [Auth Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser); no service credential is exposed to the browser.
