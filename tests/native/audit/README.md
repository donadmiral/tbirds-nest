# Independent native audit pack

This is a disposable QA harness for the frozen application. It contains **85 executable cases across 13 feature groups**: 59 direct-route entry checks and 26 selected control, error, signed-out or capture checks. It does not claim all controls, roles or hardware are accepted.

The baseline inventory is `docs/quality/native-full-app-20261031/native-audit-2f91218e/inventory.json`. It reconciles the existing action-inventory generator against application commit `2f91218e71dbcaf94ea7b454a0e3562800bfe601`: 93 registered route entries and 2,328 JSX/callback/Alert bindings. These are not 2,328 unique visible buttons. The final audit binary is bound separately to the final frozen build commit and tree.

## Build once, retain, execute independently

1. In the disposable QA checkout, run the existing `prepare-native-ui.cjs`, then `prepare-native-ui-audit.cjs` **before** native prebuild. The second overlay changes only the disposable entry import and registers an authenticated QA launcher before Main. Real App providers, stores, navigation routers and screen components execute.
2. Build and sign the Simulator app or Emulator APK once with the existing pinned scripts. Call `native-ui-audit-binary.py` after final signing and before simulator teardown. Supply the actual frozen checkout commit/tree. Retain the intact `.app` (tar preserving its structure) or APK, binary manifest and source receipt. Do not rebundle, re-sign or replace native configuration between cases.
3. Consumers verify the separately expected source/tree, binary bytes, scenario-manifest hash, package and runtime/ABI. The runner installs the same artifact once per feature shard, then calls Maestro once per case. Each case has one fresh synthetic sign-in; previous fixture/auth receipts are copied before the next case clears state.
4. Every case retains its own exit code, JUnit, screenshots, debug tree/logs and native receipt. A failed case does not stop later cases. Missing, empty, skipped, malformed or mismatched JUnit/receipts fail. Unknown fixture calls stay501 and fail the case. Failed media verification also fails the capture case.

Example consumer command, with values supplied from the frozen build job:

```bash
python3 scripts/quality/native-ui-audit-runner.py \
  --platform android --device emulator-5556 \
  --binary audit-binary/app-release.apk \
  --binary-manifest audit-binary/binary-manifest.json \
  --expected-source "$AUDIT_SOURCE_COMMIT" --expected-tree "$AUDIT_SOURCE_TREE" \
  --groups navigation,feed,market,jobs,messages \
  --output native-audit-results
```

The corresponding iOS command uses the intact Simulator `.app`, an x86_64 iOS18.5 Simulator and `--platform ios`. Android uses the isolated diagnostic-root API35 x86_64 image, as the existing acceptance script does. The runner does not grant microphone, camera, Photos, contacts or location permissions.

Suggested balanced shards per platform:

| Shard | Groups | Cases |
|---|---|---:|
| A | settings, stories, directories | 27 |
| B | support, auth, profile, business, memory | 27 |
| C | navigation, feed, market, jobs, messages | 31 |

The entry-only checks deliberately use declared navigation state so a broken upstream control cannot conceal every downstream screen. They are labeled separately from control journeys and do not prove that the real upstream navigation action works. Individual cases still stop on their first failed mandatory assertion; independence is between cases, with all results retained.

## Fixture and role boundaries

The existing strict synthetic transport remains the baseline. This pack adds exact Support ticket/message contracts, including controlled list, ticket, history, reply and secondary-status-write failures. It does not invent a trigger that copies a new ticket's original body into its message history. The actual installed Supabase SDK exercises these contracts in focused tests.

The `business` group currently checks the member-facing business application/access/create/list entry surfaces. It does **not** claim business owner or staff authorization. Positive Studio, employer/applicant, delegated identity, business-device registration, channel/community membership, group administration, MFA, verified-email/recovery, live calls and physical media acquisition require additional exact fixtures and/or provider/device evidence. Their route entries and source dependencies are explicitly listed in the inventory. Unknown successful contracts are not filled with generic empty responses.

The independent memory capture case enters the existing QA capture screen directly, then retains the original heading/readback/cancel/cleanup/encode assertions and deadlines. It signs in once and keeps that same session through both capture attempts. It does not claim the OS deep-link handoff; the unchanged baseline flow continues to own that separate boundary. The existing movie decoder runs and remains mandatory.

## Focused checks

```bash
env -u NODE_TEST_CONTEXT node --test --test-isolation=none \
  tests/quality/native-platform-audit-pack.cjs
```

The focused tests use actual installed stack/tab routers and Supabase client, execute the real Python result aggregator with controlled process results, check failure continuation and strict provenance, and apply the preparation overlay in a disposable directory. They do not substitute for native runtime, physical hardware or hosted authorization acceptance.
