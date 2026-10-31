# Database access hardening — reviewed candidates

The production and QA candidates fix verified access-control gaps and unnecessary privileges. They do not assert that every advisor warning is an exploit. No hosted database mutation was performed by the database review lane. The root release operator owns rollout and its live postflight receipt.

## Exact candidates and order

| Target | Candidate | SHA-256 |
| --- | --- | --- |
| Production | `supabase/migrations/20261029234214_database_access_hardening.sql` | `551a9ce4f90751cee7c70dd4be826036bb043fea935b7ba56fe0eb95f9a485a3` |
| Existing QA | `supabase/ops/qa/20261029235400_qa_database_access_hardening_forward.sql` | `d24f7737b0ad77b4936ff809e91ea45ff8fb9e21cf20e95fd08458bd938b8644` |

Apply after the matching admin completion and media/erasure candidates. QA uses its inspected forward adapters, followed by account Storage erasure and erasure admin review queue, then this QA delta. Do not apply the production hardening file to QA. No reset or historical migration replay is appropriate.

Immediately before applying, run `supabase/ops/check-database-hardening-preflight.sql` for production, or `supabase/ops/check-qa-database-hardening-preflight.sql` for QA. Both were read-only checked against their actual hosted catalogs on October 29: no function or table drift, trusted schemas, expected extension and policies, and no pre-existing helper collision. The migration repeats the checks transactionally; an unexpected state aborts before changes.

After applying, run `supabase/ops/check-database-hardening-postflight.sql`. Compare its function hashes/ACLs and highlight policies to the matching gate JSON. Pure ACL-only trigger entries deliberately have a null definition hash: their owner/type/ACL is checked and their body is never replaced. Four production provider hooks are represented locally by inert, unbound trigger functions because provider delivery configuration must not be exported into fixtures. Actual provider delivery is outside this database gate.

## Verified changes

- Pin the remaining 58 mutable SQL/PLpgSQL search paths. The preceding admin candidate pins three more, covering the 61 observed application findings. Both app roles lack CREATE on the trusted lookup schemas; `pg_temp` is explicitly last.
- Remove app EXECUTE privileges from 66 production security-definer trigger functions, 62 in QA because four provider hooks are absent there. Existing trigger bindings and service/owner access remain. An authenticated follow insert still generates its installed notification.
- Remove obsolete app access to email lookup, seven maintenance/dead campus routines, and unnecessary grants on 15 tables whose RLS already denies every app operation. No permissive policy is added to silence an intentional closed-table finding. Current username sign-in uses the separately deployed authenticated Edge flow.
- Move the relocatable `pg_trgm` extension from `public` to `extensions`. Keep its objects/index identifiers and update both people-search paths. Search and pagination are exercised after relocation.
- Apply profile, audience, block, hidden-from, active-account, and ownership decisions to highlight RPCs, raw references, counts/latest media, nested documents and media manifests. Authorized archived highlights remain readable; ordinary expired stories remain expired. New associations must belong to the highlight owner, while an owner can remove old invalid associations.
- Restrict the user-ID unread-count overload to the caller's own conversation membership and exclude deleted messages. Keep its response shape and the separate no-argument overload.
- Restrict profile reach to the owner or authorized delegate, and recent liker names to visible posts and unblocked active people. Keep the deployed post-audience contract and cap liker requests at 200 references.

## Regression evidence and correction

The actual production `content_media_manifest(jsonb)` already works for ordinary posts while the optional `creator_has_active_subscription(uuid,uuid)` helper is absent. Its pre-change MD5 is `1bc0a04f263b282b5e785127ab0f0078`. An earlier investigation misread an intermediate source definition as the final deployed definition. That inference was corrected before any hosted write. There is no missing-function media hotfix in this candidate or its rollout order.

The new gate explicitly executes the actual final production projection before hardening, proves the helper is absent and ordinary media succeeds, then repeats ordinary-media delivery after hardening. QA separately has the real helper and an outer sound-rights wrapper. The QA candidate changes only the inner highlight projection, preserving the wrapper and entitlement/rights functions byte-for-byte. Its ordinary-media regression runs with those actual QA dependencies, rather than adding a fake helper or bypassing rights.

Both complete local database chains pass **18 behavior cases each**. The production chain includes the sealed push/group authorization patch, 25 deployed rollout units, four deployed repairs, current admin completion, account erasure, private media compatibility, erasure queue, and bounded delivery before hardening. QA reconstructs its inspected catalog and private media adapters, preserves the synthetic counterparts of its existing 1 Auth / 1 staff / 1 profile / 15 Storage objects and session/bucket state, and then runs the same behavior cases. Gates are written only after all 18 cases complete successfully.

Cases include role denial, installed trigger behavior, temporary-table shadowing, search compatibility, private/expired/hidden/blocked highlights, foreign story association rejection, current manifest checks, inbox ownership, deleted messages, reach privacy, liker audience and size limits, and replay/drift rejection. PGlite is an isolated PostgreSQL runtime; this evidence does not replace hosted postflight checks, authenticated browser walkthroughs or device testing.

## Advisor interpretation and remaining platform work

The inspected initial production snapshot had 61 mutable application paths, 216 anon and 377 authenticated security-definer execute findings, 52 RLS-enabled tables without policies, one extension in `public`, and disabled leaked-password protection. Counts describe advisor findings, not proven exploit totals. This candidate deliberately does not revoke every definer RPC: many are legitimate identity-checked interfaces. Closed internal schemas/tables retain intentional denial policies.

Leaked-password protection and the production PostgreSQL 17.6 to current patched platform upgrade require provider configuration work outside this SQL delta. QA was observed on 17.11. These settings must be checked in their actual provider environment; they are not marked fixed by the local gate.

Primary references: [PostgreSQL function security/search-path guidance](https://www.postgresql.org/docs/current/sql-createfunction.html), [Supabase database linter](https://supabase.com/docs/guides/database/database-linter), [Supabase password security](https://supabase.com/docs/guides/auth/password-security), and [Supabase Postgres 17.11 release](https://supabase.com/changelog).

## Reproduce

```sh
DATABASE_HARDENING_GATE_OUTPUT=docs/quality/DATABASE_HARDENING_GATE_20261029.json node supabase/tests/rpc-authorization/test-database-hardening-chain.mjs
PLATINUM_QA_DATABASE_HARDENING=1 DATABASE_HARDENING_GATE_OUTPUT=docs/quality/QA_DATABASE_HARDENING_GATE_20261029.json node supabase/tests/rpc-authorization/test-database-hardening-chain.mjs
```

`scripts/quality/build-qa-database-hardening.cjs` reproduces the QA candidate from the frozen production candidate and the captured QA metadata. It performs no hosted operation.
