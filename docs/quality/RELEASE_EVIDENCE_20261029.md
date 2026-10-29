# Release evidence — 2026-10-29

**Status: the reviewed production database rollout and both required media endpoints are deployed and verified. iPhone build 16 has finished and was submitted successfully to App Store Connect; Apple is processing it. Production frontend promotion, TestFlight availability, distribution/installation and installed-device verification remain pending receipts.** Readiness of a QA deployment does not establish production frontend delivery.

## Identified versions

| Item | Recorded evidence |
| --- | --- |
| Tested frontend source | `31c2251c37d082af9cdcdae58cefb1968008c36a` |
| GitHub CI | Run `40827013295`: all three jobs succeeded, as reported by the release owner. The phone job includes the committed RPC suite. |
| QA web and admin | Deployments from `31c2251` are `READY`; QA aliases were reloaded for verification. |
| Production iOS build | Build **16**, EAS ID `df17a360-0dcd-4ece-9624-4dc2084c10c8`: **FINISHED**, artifact exists and **submitted successfully to App Store Connect; Apple processing**. |
| iOS submission | EAS submit completed **SUCCESS, exit 0**. Submission `21c8a8ae-68af-4a35-a6dc-8c206021681e`: [submission receipt](https://expo.dev/accounts/donadmiral/projects/platinum-circles/submissions/21c8a8ae-68af-4a35-a6dc-8c206021681e). |
| TestFlight destination | [App Store Connect TestFlight](https://appstoreconnect.apple.com/apps/6764038613/testflight/ios); availability to testers and installation have not yet been verified. |
| Production bundle | `app.platinumcircles.mobile`; QA bundle `app.platinumcircles.mobile.qa` is separate. |
| Production rollout | All 18 ordered units / 19 SQL source files are applied. The first seven additive units were retained; units 8–18 were applied successfully under the `platinum_visual_only_20261029_u08` through `_u18` release prefixes. |
| Production media endpoints | `content-media-sign`: **ACTIVE v1**; `chat-media-sign`: **ACTIVE v15**. Both have `verify_jwt=true`; other endpoints remain held. |
| Final manifest SHA-256 | `c3023f8dc69ba1b9e6857553c15bc337ede3b3ca0cbe7074632bba5ad14c2136` |

The manifest hash includes the metadata correction from the obsolete “unit31” wording to the actual book **unit8**. SQL source hashes did not change. The final backend/ops/test changes remain separate from the identified frontend commit until the release owner records their commit.

## Observed QA behavior

The release owner inspected the signed-in QA profile showing **six posts and two books**. A screenshot of the updated book reader confirms that saved text and its styling are visible. Both narrowly scoped QA patches—the book read projection and canonical public-post reference-card guard—were applied successfully.

The release owner also checked reader page 3: its video decoded at **720 × 1280**, reported `readyState=4` and no error, initialized at **0.5 seconds with playback rate 1.5**, and entered the playing state after clicking Play. This supplies actual browser evidence for decoding, the saved start/rate and playback; it does not by itself verify the entire trim-end loop.

These observations cover that QA account and flow. They do not verify the physical iPhone build, every viewport/gesture, or a signed-in admin walkthrough.

## Production receipts

The release owner reports successful application of every remaining unit, 8–18, using the manifest hash above. Production postflight confirms:

- All **16 required RPCs** exist, permit `authenticated` execution and deny `anon` execution.
- Exactly **ten historical read associations** exist: five post pairs and five story pairs.
- Direct client SELECT/INSERT permissions on the finite legacy registry remain false, and all held-infrastructure predicates remain true.
- Exact production before/after music and excluded-state fingerprints match, including the 21 audited data sets, schema/function/policy definitions and Storage settings.
- Only `content-media-sign` v1 and `chat-media-sign` v15 were deployed; both are active with gateway JWT verification enabled.

## Verified source and database checks

The final local command `npm test --prefix supabase/tests/rpc-authorization` exited **0** against the complete 18-unit manifest. It covers the production-matching baseline plus the seven applied units, then the exact remaining source files. All 19 production source hashes and both QA patch hashes match the manifest.

The isolated suites cover book creation/cover/order/privacy and saved media recipes; current story publication, mentions, reply controls and canonical post cards; Discover projections; legacy chat consumption; group-call admission and delayed-leave compatibility; and the ten exact historical media read associations. No new music or subscription helper is substituted to make these tests pass.

Local and actual production before/after checks show that the chain leaves existing music state, the 21 audited finance/payment/market/hiring/support data sets and their relevant schema/functions/permissions, all Storage bucket settings/policies, and existing post-access helpers unchanged. Local managed Auth/Storage fixtures do not establish every hosted provider behavior; the separate production receipts above record the hosted checks actually performed.

The release owner reports native, web and admin TypeScript gates passing; web tests passed across 41 files, admin tests passed 81 cases, and native tests passed 799 cases after rerunning 32 sandbox-dependent checks. GitHub CI success above applies to its identified committed inputs; the final local database run establishes the separately prepared rollout manifest.

## Explicit release boundaries

Automatic approval review rejected `20261022211311_story_sound_rights.sql` and later `20261022211313_creator_finance_operations.sql`. **Neither rejected migration was applied.** Their behavior is not retried or recreated in this rollout. The seven previously applied additive units, including the closed finance foundation, remain intact.

Only `content-media-sign` and `chat-media-sign` were deployed. Daily v34, all Crisp/payment/recovery, export and faststart endpoints remain unchanged. The one group-call SQL unit preserves APIs already used by the shipping client. Music selection and private-media sessions remain disabled.

QA-only migrations `20261029055318_memory_book_reader_visual_projection.sql` and `20261029060247_story_public_post_reference_cards.sql` are excluded from production because the selected production units already contain those definitions. Superseded `20261029054347_visual_content_media_manifests.sql` is also excluded; production selects `20261029055844_visual_media_existing_visibility.sql`. The archived 35-unit plan must not be executed. Historical `tools/windows` files are outside this release.

## Evidence still required

- Production web/admin alias promotion receipts and checks against those exact deployments.
- Completion of Apple processing, TestFlight availability, distribution/installation status and actual physical-iPhone verification of build 16.
- A signed-in admin visual walkthrough.
- Web CameraKit secure configuration and live camera/lens behavior.

The release owner must update these remaining statuses from actual receipts before describing the frontend as promoted or the user's installed iPhone experience as verified. The ordered source and check queries are in [PRODUCTION_ROLLOUT_20261029.md](PRODUCTION_ROLLOUT_20261029.md) and `supabase/ops/production-rollout-20261029.json`.
