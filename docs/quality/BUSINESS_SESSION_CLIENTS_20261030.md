# Business account sign-in and owner launch — client verification

Date: 2026-10-30. Scope: actual web and native client source with synthetic Auth, network and native-storage adapters. These checks did not create hosted users, send email, access production or exercise a physical phone.

## Result

The web and native clients now consume the server-bound business-session protocol. A response must identify the business, staff member and role and contain an access/refresh token pair. Clients verify the destination through Auth before replacing the current account. Legacy `token_hash` responses are refused; the business flows no longer call client `verifyOtp`.

The existing owned-business list now has an owner-only **Open Studio** action. It calls owner access with `business_id`, so current transferred owners and owners of directly created businesses do not need an original application record. The application history retains its `application_id` launch path. Both paths use the same secure preparation helpers. The existing `get_my_businesses` contract was independently checked against QA: it is an invoker function filtering personal memberships by `auth.uid()`. The list is an entry point; the Edge endpoint independently verifies current ownership before issuing a bound session.

### Device registration

Web creates a random UUID plus 32 cryptographic random bytes, stores the pair under `pc:business-device:v2`, and verifies storage readback. Native uses Expo Crypto and SecureStore under `pc.business-device.v2`, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` accessibility. The native key uses periods because SecureStore rejects colon characters. A module-level in-flight promise prevents concurrent native callers from generating and overwriting separate registrations.

Corrupt storage, failed writes, failed readback and unavailable secure randomness fail closed. There is no vendor-ID or shared-installation fallback. Tokens and access codes are not written to the device-proof store.

### Account and workflow handling

- Team sign-in works from a signed-out session or a confirmed current personal account.
- Owner access uses the current personal identity. An initial-owner setup response displays an explicit confirmation explaining the owner seat and approved first device; only the subsequent user action sends `bootstrap_owner: true`.
- A blocked or pending device does not replace the current account, and does not trigger automatic owner setup.
- Requests are serialized synchronously, so duplicate clicks/taps cannot start duplicate handoffs.
- Preparation, network requests and current-account checks are cancellable and bounded. Their 15-second timeout restores a retry path.
- Account changes, unmounts and cancellation invalidate pending work. Old owner-setup confirmation callbacks also stop working after cancellation or account changes.
- The exact expected business ID **and access token** identify the intentional Auth event. Another event cannot masquerade as the intended handoff.
- Final `setSession` installation is deliberately non-cancellable because the Auth SDK cannot cancel it once started. Cancel controls are removed for this stage; the native screens also disable their explicit Back controls. Forced app/browser closure cannot cancel an Auth SDK operation already in progress; later UI work is still suppressed after unmount.
- Clients verify the installed and currently selected business identity before reporting success or navigating. Web reloads into `/studio` to clear the previous account's client state. Native relies on the existing global Auth observer rather than dispatching a stale route after switching accounts. The newly mounted native tab navigator starts a resolved business profile in **Studio**; personal and creator profiles retain **Feed** as their initial tab. The Auth store clears the old profile on an identity change, and the navigator waits for the new profile before mounting the account's tab tree.
- Application drafts, history, handle availability and owned-business lists discard old account results. Failed submissions retain their current-account draft; failed list reads display retry states.

### Auth transport completion

The browser client factory and native shared client now wrap only their own backend's `/auth/v1/` requests. Normal Auth requests have a 15-second deadline. Refresh-token grants retain a **60-second** deadline to preserve the native client's existing allowance for refresh rotation on slow networks. These are per-request transport budgets, not a claim that every `setSession` call finishes in exactly 15 seconds: the installed SDK can retry a retryable refresh within its own refresh window.

The deadline covers both headers and the complete body. A clone is drained before returning the original Response, with an 8 MiB Auth-response cap. This preserves the original status, headers, URL metadata and readable body. The native buffered-response fallback also remains inside the deadline. REST, Storage, Edge and unrelated-origin requests keep their existing transport and streaming behavior.

The wrapper aborts the actual fetch and suppresses a late response even if an adapter ignores the abort signal. It does not race and unlock `setSession`. Tests exercise both installed Supabase SDK versions with stalled headers and stalled bodies: the existing personal session remains selected after the timeout and after a deliberately late response, and a subsequent valid business sign-in succeeds.

## Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Actual web sign-in, application and owned-business components, with deferred provider responses | **52/52 passed** | [Web test output](business-session-clients-20261030/web-client-tests.txt) |
| Actual native screens and device/session service, with deferred Auth and SecureStore adapters | **48/48 passed** | [Native test output](business-session-clients-20261030/native-client-tests.txt) |
| Auth transport, actual installed SDK session installation, native initial-tab tree | **17/17 passed** | [Auth transport output](business-session-clients-20261030/auth-transport-tests.txt) |
| Existing content-media and native transport concurrency regressions | **7/7 passed** | [Media transport output](business-session-clients-20261030/transport-media-regressions.txt) |
| Complete web TypeScript project | Passed, exit 0 | [Web type output](business-session-clients-20261030/web-types.txt) |
| Complete native/root TypeScript project | Passed, exit 0 | [Native type output](business-session-clients-20261030/native-types.txt) |
| Scoped ESLint | Zero errors; warnings recorded in the receipt | [Web lint](business-session-clients-20261030/web-lint.txt), [native lint](business-session-clients-20261030/native-lint.txt) |
| Scoped whitespace/diff check | Passed | Recorded in receipt |

The full native and web type checks passed with the transport wrapper and native initial-tab change. The final addition only selects the preserved 60-second refresh budget; the combined final verification workstream reruns all three project type checks and the complete native/web suites against that frozen source. The focused transport suite includes the refresh-budget assertion.

The suites execute the checked-in clients and helpers. They verify secure device generation/readback, concurrent registration, blocked storage, corrupt registrations, wrong destination and installed identities, old unbound response rejection, owner setup, current-owner launch by business ID, lost ownership, nonowner UI, pending/blocked/rate-limited provider responses, cancellation, unmount, concurrent account changes, response timeouts, double submission, failed reads and retained application drafts. Deferred responses deliberately arrive after cancellation or account switches.

Commands:

```sh
node web/tests/business-application-regressions.cjs
node tests/quality/business-session-clients.cjs
node tests/quality/auth-transport-deadline.cjs
node tests/quality/content-media-concurrency.cjs
./node_modules/.bin/tsc --noEmit --pretty false
cd web
./node_modules/.bin/tsc --noEmit --pretty false
```

The existing root quality workflow discovers the native test file through `tests/quality/*.cjs`; the existing web regression file remains part of the web test glob. No new provider credentials or test identities are embedded in these fixtures.

## Changed client source

- `web/lib/businessAccess.ts`
- `web/app/business-login/page.tsx`
- `web/app/businesses/page.tsx`
- `web/app/businesses/apply/page.tsx`
- `src/services/businessSessionService.ts`
- `src/screens/auth/BusinessSignInScreen.tsx`
- `src/screens/profile/BusinessApplyScreen.tsx`
- `src/screens/profile/BusinessesScreen.tsx`
- `web/tests/business-application-regressions.cjs`
- `tests/quality/business-session-clients.cjs`
- `shared/authFetch.ts`
- `web/lib/supabase/client.ts`
- `src/services/supabase.ts`
- `src/navigation/AppNavigator.tsx`
- `tests/quality/auth-transport-deadline.cjs`
- `tests/quality/content-media-concurrency.cjs` (test adapter imports the new shared transport)

The shared protocol parser, SQL and Edge handlers are maintained in the separate business Auth server change. [Client receipt and source hashes](business-session-clients-20261030/receipt.json) identify the exact source checked here.

## Acceptance boundaries

These client results do not establish live provider success or installed-phone behavior. The QA Edge/SQL deployment, actual Auth reserve/create/bind/finish process and browser walkthrough have separate evidence owned by the server/deployment workstream. Native SecureStore, device cancellation/interruptions and successful account opening still need the installed iPhone pass.

Current owners now have a launch entry without an application. After the first owner/device setup, a new owner device still requires approval by an already authorized owner or administrator. Sole-owner recovery when all approved devices are lost is not implemented by this client change. The clients show the approval/blocked result accurately rather than approving that device themselves.

The secure protocol intentionally requires the updated clients. This source change does not update an already installed native binary. TestFlight release status and production compatibility remain governed by the broader acceptance decision.
