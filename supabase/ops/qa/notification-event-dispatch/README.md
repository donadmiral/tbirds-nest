# Source-only QA notification event dispatch candidate

This package is not installed or deployed. It is an alternative to the uninstalled
Vault-service-key queue hooks, not a provider ACL repair. It does not change the
hosted business-auth stage, music readiness, existing handlers, or production.
The file was created with `supabase migration new` and moved out of automatic
migrations so a normal migration push cannot activate this proposal.

## Why this is needed

The inspected QA `net.http_request_queue` and `net._http_response` tables grant
PUBLIC access. The provider owns both tables and the `net` schema. The connected
`postgres` role cannot repair those ACLs. The previous setup correctly refused
to store a long-lived service credential in the readable queue. This design
does not make that credential available to the queue at all.

## Authorization boundary

An existing database notification or call inserts one private event job. Its
random 256-bit capability expires within two minutes. A call capability also
expires no later than the call's original ringing deadline, bounded to ninety
seconds. The private job stores the SHA256 digest, exact canonical event and
state. `pg_net` receives only an opaque job ID and the one-event capability.
It receives no recipient, message text, provider token, service credential,
signing key, selectable URL or executable input.

The public dispatcher accepts exactly `jobId` and `token`, within 1,024 bytes.
It calls a service-only RPC that atomically changes one queued job to claimed.
Wrong, expired, paused, consumed and mismatched capabilities cannot claim a job.
Deleted notifications, deactivated recipients, canceled calls and revoked
initiating sessions fail the claim checks. The RPC returns the authoritative
event type and ID, never a caller-selected target.

The dispatcher rechecks the claimed lease, expiry, enabled setting and absence
of an enabled legacy mode immediately before forwarding. A pause or mode switch
after the initial claim prevents a fresh forward. It then forwards that ID to
one of two fixed same-project QA endpoints.
The service credential travels only in the Edge-to-Edge request. Redirects are
disabled. The existing ordinary/call handlers remain unchanged. They retain
their current recipient preference, quiet-hour, device, call-origin/session,
membership and block checks, including per-batch current-call authorization.
The capability does not replace any of those checks.

The settings and jobs have RLS enabled with no app policies. App and service
roles have no direct table or schema access. Only `service_role` can execute the
three narrow public claim/recheck/finish RPCs, which also check the signed role claim.
The private enqueue and trigger helpers are not callable by app/service roles.
The installer leaves dispatch disabled and does not replay historical events.
If the older credential-based mode is enabled, this mode does not enqueue,
preventing two active dispatch paths from sending the same event.

## Queue visibility and delivery limits

Someone who can read the provider queue can copy its short-lived capability.
That person can advance the already-authorized canonical event by invoking the
dispatcher. The atomic claim still permits only one forward and never arbitrary
content or recipients. Someone who can delete or alter provider queue records
can suppress the legitimate attempt. This candidate cannot remove that
denial-of-service risk. Provider-owner ACL repair remains desirable.

The dispatcher uses at-most-once forwarding. Once claimed, a job cannot be
reclaimed automatically, including after a timeout, lost acknowledgement or
process crash. That avoids duplicate pushes after an uncertain provider result,
but a crash between claim and forward can lose the attempt. `claimed` without a
finish, or `unknown`, requires operator inspection. No automatic retry or claim
reset is implemented or implied. A successful `accepted` state means the
downstream provider accepted the request, not that a phone displayed it.

The pg_net request has a 45-second timeout, above the dispatcher's 30-second
work deadline and independent 3-second acknowledgement deadline. These are
bounds, not delays before work begins. A queue/gateway timeout can still happen
after the claim or provider acceptance. The private job status is then the
authoritative diagnostic record. A timed-out `_http_response` is never a reason
to resend a consumed event automatically. If the original caller disconnects,
the dispatcher cancels its in-flight forward where possible and records an
unknown result. It cannot retract a request already received by a provider.

Once a downstream HTTP call begins, a later dispatch-feature switch cannot
retract it. The existing handlers continue to check live account/call/recipient
authorization, but they do not consult this feature flag. To change delivery
modes, pause both, allow unclaimed capabilities to expire and active deadlines
to elapse, inspect every claimed/unknown job, then enable only the reviewed mode.
Do not toggle flags concurrently with an attempted replay. The old mode must
also satisfy its own provider-queue privacy preconditions.

Both body parsing and calls have deadlines. Malformed capabilities fail before
the database lookup. A well-shaped random capability still requires one indexed
lookup. Platform-level request limiting should be reviewed with the endpoint's
normal abuse controls before activation. This package does not assert a load
test or an external rate-limit configuration.

Operator-only retention deletes at most 500 event jobs whose capabilities
expired more than seven days earlier. It never deletes the canonical event.
It cannot cause an old notification/call to be queued again because enqueue
checks original event age. The explicit DELETE remains visible to the
provider's normal destructive-SQL confirmation path. No classifier bypass is
part of this package. A reviewed operator schedule must invoke the private
retention helper after activation.

## Review and future QA rollout order

1. Resolve or definitively inspect the outstanding business-auth connector
   invocation before any new database mutation. Its outcome was never returned.
2. Review the candidate, source hashes and local evidence. The old credential
   setup and event dispatcher must not both be activated. Do not apply the old
   credential hook installation as a prerequisite for this alternative.
3. Apply the exact candidate through the supported migration tool, retaining
   any SQL confirmation. Verify disabled settings, all private ACLs/RLS,
   service-only claim/finish grants and trigger definitions. Check that pg_net
   privileges were not changed and that no historical job was created.
4. Render `index.ts.template` and `handler.ts.template` unchanged to `index.ts`
   and `handler.ts`. Deploy those files and their two shared dependencies as
   `dispatch-notification-event`. The handler authenticates its event capability
   itself, so the gateway must accept that request format. The source rejects
   every origin except the exact QA project. No production deployment is ready.
5. Read back the exact deployed dispatcher and both existing handler bundles.
   Verify unauthenticated, forged-token, wrong-target, replay, expiry, canceled
   call and revoked-session denials using disposable QA events. Do not use
   ordinary users' phones for these setup checks.
6. Record the three verified bundle hashes and QA origin in the disabled
   `notification_delivery.event_settings` row. Enable only after review and
   check the three indexes, one-use claims and final canonical handler checks.
7. Observe an actual queue request, dispatcher claim, final handler response,
   provider acceptance, then installed-device receipt separately. A database
   `queued` state is not an Edge, provider or physical-device acceptance result.
8. Add the reviewed bounded retention schedule. To pause future delivery, set
   only the event settings `enabled` field to false. Existing jobs remain for
   diagnosis, and paused or expired capabilities cannot be consumed.

## Verification commands and scope

`node tests/quality/notification-event-dispatch.cjs` executes the actual
TypeScript dispatcher with synthetic RPC and HTTP boundaries. It checks fixed
targets, canonical payloads, input bounds, replay denials, cancellation,
acknowledgement uncertainty and outcome handling.

`node supabase/tests/rpc-authorization/test-notification-event-dispatch.mjs`
applies the actual SQL to the recovered QA-schema fixture. It leaves the
synthetic pg_net queue readable to app roles and checks that an observed token
still only authorizes the existing canonical event. It also checks grants,
atomic claims, pauses, expiry, revocation, group-call creation, deletion,
duplicates, queue failures and bounded retention. This suite is included in
the isolated RPC runner.

Rendering both templates unchanged in an isolated directory with the same relative
paths and running `deno check --no-lock --node-modules-dir=none index.ts`
checks the complete Edge entrypoint with the pinned Supabase client. The template
files are kept outside the native TypeScript project. Local
tests do not establish hosted installation, actual extension-worker behavior,
provider delivery or phone display. No network/provider call occurred in the
synthetic suites.
