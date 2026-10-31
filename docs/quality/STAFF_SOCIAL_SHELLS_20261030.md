# Future staff social profile isolation

## Result and boundary

The forward candidate isolates every staff identity reserved after a successful cutover. It records a private marker before Auth creation, makes the actual Auth-created profile hidden immediately, blocks user-authored social writes and owner-bound Storage uploads, and prevents later social reactivation. A failed or interrupted finish remains isolated. Only the matching reserved Auth identity can receive the reviewed staff role.

Existing owners, existing staff, completed reservations, personal accounts, business identities, Auth sessions, and the current optional-MFA policy are preserved. The migration does not backfill or deactivate any existing profile. It refuses deployment while an older staff reservation remains incomplete, so an unfinished legacy setup cannot silently cross the new boundary.

The production-chain and QA-chain suites each pass **16 cases**. The independent CI reviewer separately reran both with the same result and found no remaining concrete migration defect. A read-only hosted QA preflight passed every guard and observed **1 Auth identity, 1 profile, 1 staff row, 15 Storage objects, and 0 provision reservations**. This implementation lane created no hosted identity and made no hosted database change; the release operator owns any application and postflight receipt.

## Verified defect

The deployed Auth trigger creates an ordinary personal profile with no `deactivated_at` value. The previous staff finish used `INSERT ... ON CONFLICT DO NOTHING` and did not deactivate that profile. The native sign-in code also attempts to clear `deactivated_at` on a self-deactivated account. Existing profile update grants and ordinary social-write policies therefore make a timestamp-only patch insufficient.

The fixture executes the actual captured `public.handle_new_user()` function and its actual `on_auth_user_created` binding. Their definitions were checked against the live QA catalog:

| Contract | Definition MD5 |
| --- | --- |
| `public.handle_new_user()` | `02467b6f2fcb8a6928cdaebe097e6bbc` |
| `on_auth_user_created` trigger binding | `786e53a33077b3a68f1ec248e238d18a` |

Before applying the candidate, the fixture demonstrates that a reserved staff identity receives an active personal profile at Auth creation. After cutover, the equivalent real-trigger insertion receives an already hidden profile before finish is called.

## Implementation

`admin_ops.staff_social_shells` contains only a fresh reserved UUID, its command key, its provision ID and its reservation time. The private table has RLS and no direct privileges for anon, authenticated or service roles. It is populated only when the trusted provisioning function creates a new staff reservation. An explicit guard rejects an already existing Auth or profile identity; callers cannot choose the reserved UUID.

The new profile trigger applies only to a registered UUID. It validates the Auth email and trusted `app_metadata.triniti_provision_id` against the exact staff reservation. On initial insertion it sets `deactivated_at`, makes profile visibility private, and clears the push token. On later updates it preserves that isolation and rejects attempts to clear deactivation or transfer the profile ID. Harmless server-side staff metadata updates continue to work.

Finish retains the existing UUID/email/trusted-metadata checks, reasserts the hidden profile state, and then inserts the staff role in the same transaction. A failed audit or another finish error rolls back the role grant and completion while the earlier private reservation and hidden provider-created profile remain available for a safe retry. Replaying a completed request does not create a second marker, role or audit entry, or reset the deactivation timestamp.

The exact existing `account_erasure.assert_writable(uuid)` definition is extended with a registered-staff check. Its shared erasure lock and existing missing-identity and erasure-job checks remain. The existing statement triggers cover every ordinary table in `public`, `creator_finance`, and `marketplace_ops`; the existing Storage trigger also checks the real object owner. The migration checks that this coverage is present and enabled before installing the new boundary.

The verified access boundary covers user-authored social writes and member-facing profile visibility. The inspected profile SELECT policy excludes deactivated profiles from other signed-in members. Protected operations continue through the server's service client, verified actor/session and current staff permissions. `adminFromToken`, `triniti_admin_session_check` and `admin_ops.require_session` do not require an active social profile. The new staff identity remains unbanned in Auth, and valid AAL1/AAL2 staff support operations still work. Revoked, expired and insufficient-role sessions still fail.

The registry persists when staff access is deactivated, so removing a staff role does not turn that sign-in into a personal social account. Business provisioning retains its separate behavior: an active delegated business profile and a business Auth identity banned from direct sign-in. No staff marker is created for a business.

## Deployment artifact

| Artifact | SHA-256 |
| --- | --- |
| `supabase/migrations/20261030012831_staff_social_shells.sql` | `fbb7d221defb64168d6601f55ffdcb21ff4f061430a340e420e3b766ed3457a0` |

The migration was created with the official Supabase CLI. It is a new forward migration; the previously frozen admin, erasure, privacy and hardening migrations remain unchanged.

Required predecessor state is the reviewed admin completion and account-erasure chain. The migration validates exact provisioning/write-guard/session-helper definitions, owners and execution grants, the current profile visibility policies, and all installed write guards. It runs under the existing staff-governance advisory lock.

`STAFF_SHELL_PENDING_STAFF_REVIEW_REQUIRED` is an intentional deployment stop. Review and complete or otherwise resolve that existing setup through the authorized workflow before retrying the migration. Do not alter or bypass the guard to force a cutover. The inspected QA project currently has no such reservation.

Expected postflight function hashes:

| Function | MD5 |
| --- | --- |
| `public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)` | `def6cbc9557e3ec5fa22ce85b003a291` |
| `account_erasure.assert_writable(uuid)` | `b4bf8700c07c75a0c6b8dadb7b9051ef` |
| `admin_ops.enforce_staff_social_shell()` | `60f85bff8f70e05c3401c4a35d7173b1` |
| `admin_ops.require_session(uuid,uuid,text)` — preserved | `2a59dac44760254e1f2e730c6154d9a9` |
| `public.triniti_admin_session_check(uuid,uuid)` — preserved | `ba2e1c694288129ee94d8b6d06746eef` |

Run `supabase/ops/check-staff-social-shells-preflight.sql` immediately before application. All guard booleans must be true. After application run `supabase/ops/check-staff-social-shells-postflight.sql` and compare definitions, ACLs, trigger and registry state against the matching local gate. The new registry is empty at deployment and existing identity/profile/staff/Storage counts remain unchanged. The fixture's synthetic counts differ from hosted observations and must not be treated as deployment targets.

## Verification and evidence

The 16 cases cover preservation, reserve-time isolation, real Auth-triggered profile creation, pending and completed social-write denial, user and service-owned Storage attempts, successful protected support operations, AAL1/AAL2 admission, expired/revoked sessions, wrong provider metadata, transactional failure and retry, replay/idempotency, harmless staff metadata edits, denied restoration, business preservation, legacy-owner preservation, private ACLs, unchanged erasure fences, and repeated/drifted/pending-setup preflight rejection.

```sh
node supabase/tests/rpc-authorization/test-staff-social-shells-chain.mjs
PLATINUM_QA_STAFF_SHELLS=1 node supabase/tests/rpc-authorization/test-staff-social-shells-chain.mjs
```

Both runs are registered in `supabase/tests/rpc-authorization/run-all.mjs`.

Evidence files:

- `STAFF_SOCIAL_SHELLS_DB_GATE_20261030.json`
- `QA_STAFF_SOCIAL_SHELLS_DB_GATE_20261030.json`
- `QA_STAFF_SOCIAL_SHELLS_PREFLIGHT_20261030.json`

These local database cases model the actual Auth database trigger, provider-created identity, and server contracts. A hosted Auth Admin reserve/create/finish test with an approved disposable identity is still a distinct provider acceptance step. The source work does not establish a new installed-device walkthrough or change the TestFlight hold.

## Hosted QA installation

Root applied the exact frozen candidate to QA after all fresh preflight guards passed. `QA_STAFF_SOCIAL_SHELLS_POSTFLIGHT_20261030.json` records matching definitions, execution grants, the enabled profile trigger and the empty private registry. Counts remain 1 Auth identity, 1 profile, 1 staff row, 15 Storage objects and zero provision reservations. No identity was created or converted. Production was not changed.

No current pruning path deletes provisioning reservations. A future retention/pruning mechanism must retain the staff isolation marker while its Auth identity exists; deleting the referenced reservation would otherwise cascade to that marker. Review that invariant before introducing such a mechanism.
