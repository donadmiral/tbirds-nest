# Ordinary Expo push admission

This QA-only SQL prototype reserves up to 100 device sends for one leased ordinary notification. It grants at most 500 device admissions across a rolling second inside one database. Requests share eleven 100 ms slots. The 500 figure is a candidate QA budget. The Expo project publishes a 600-notification-per-second limit across all senders.

Each lease can receive one grant. Replaying a grant returns `already_reserved`. Only `granted` authorizes the initial send. On exhaustion, the transaction returns the unspent claim attempt, clears the lease deadline, and sets eligibility 1.1 seconds ahead. A caller whose grant response disappears needs reconciliation before sending. More than 100 distinct devices returns `requires_device_checkpoints` and leaves the job intact.

## Existing delivery paths

Ordinary queue workers lease a notification, recheck eligibility, and call `createCompatiblePushHandler`. It resolves up to 1,000 device registrations. The common sender groups them into requests of at most 100, and the worker stores one set of aggregate counts for the entire notification. The existing ordinary webhook and Android ring handlers call the same Expo sender independently. Android rings also check whether the call can still ring. iOS VoIP takes its own provider path.

The reproduction in `supabase/tests/notification-outbox.test.cjs` sends 601 synthetic devices through the real batch helper. A gate after five batches returns 500 accepted and 101 rejected. The current worker treats those counts as complete. Retrying the complete notification instead repeats the first 500 device sends.

## Requirements before activation

1. Persist progress for each device or immutable batch under the notification and a fenced lease. Recheck current authorization, registered devices, preferences and expiration before sending pending work.
2. Distinguish admission denial, an unused grant, a known provider rejection, and an unknown provider outcome. Commit accepted device receipts before retrying unsent work. A bounded recovery path must cover loss of the final provider or database acknowledgment.
3. Admit the remaining batch against one project-wide budget immediately before sending. Reserve room for time-sensitive Android rings, propagate call cancellation, and cover the legacy rollout overlap. Observe ordinary backlog age, rate deferrals, unknown outcomes, ring latency and Expo throttling.
4. Exercise a recipient with 1,000 devices and simultaneous ordinary and ring workers in a disposable environment. Verify stable progress across timeouts, process crashes, and credential rotation before enabling a canary.

The SQL sits outside the migration directory. No Edge Function invokes it. The database concurrency CI test uses eight independent sessions on a disposable PostgreSQL 17 database.
