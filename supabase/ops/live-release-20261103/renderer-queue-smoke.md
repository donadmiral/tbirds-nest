# Minimum real renderer and scheduler acceptance

This operator procedure exercises one actual durable clip job from a three-second synthetic HLS recording. It creates a disposable, passwordless identity and an invite-only ended session, with no invitations or publication. It does not start Daily. No hosted action is performed by the preparation script.

The accepted image digest and healthy finite worker are prerequisites. Keep the ECS service at zero, ASR disabled and the schedule disabled while preparing the source. The production clip runtime is initially disabled with max_active=2. The initial queue must have due=false and active=0; due maintenance work is not an idle queue.

## Prepared fixture

The current local plan is `/tmp/platinum-live-cdn-fixture-AP6aiz/renderer-queue-plan.json`. Its source was generated and decoded locally; its prepare/enqueue/inspect/cleanup SQL passed six isolated database checks. This proves the operator recipe, not hosted rendering.

To regenerate a fresh fixture if needed:

```sh
node supabase/ops/live-release-20261103/prepare-renderer-queue-smoke.mjs \
  --bucket platinum-live-production-livebucket-6v2z2lrobdn3 --directory /tmp
```

The plan names four exact SQL files and five local media files. Use a plan only once; regenerate after its identity is cleaned up. No database migration or runtime source change is needed.

## Execute in order

1. Review and execute `renderer-prepare.sql` through the authorized production management SQL tool. Save the returned fixture receipt, especially `source_prefix`. It inserts only the random synthetic Auth user/session/profile, calls the existing `public.live_command('create', ...)`, and marks that one synthetic recording ended. No provider readiness flag changes.
2. Upload the five `upload_files` from the plan to the private Live S3 bucket. **Each destination is the SQL receipt's `source_prefix` plus that file's `relative_path`.** The underlying media generator's original storage paths belong to a different, unused UUID namespace; do not upload there. Use the supplied MIME/cache metadata. Record the exact key, returned VersionId, size and SHA-256 for every object, without signed URLs or credentials.
3. After image/startup acceptance and source upload, explicitly admit the bounded clip queue using the existing operator function:

```sql
select public.live_clip_configure(
  'https://prlkikhckbifseosbukl.supabase.co', true, 2
);
```

4. Execute `renderer-enqueue.sql`. It calls the real clip command twice with the same request ID and requires one matching clip plus the duplicate acknowledgement. The requested range is 0–2,000 ms, both horizontal and vertical, one reviewed synthetic subtitle, a 500 ms cover and the required watermark. It does not claim or finish work, write Storage metadata, or publish anything.
5. Enable the reviewed renderer-only scheduler using the existing launcher change. Keep `AsrEnabled=false`, the fixed daily ledger budget and the service at zero. A scheduled tick should launch one finite task with the reviewed image digest; one 720-second reservation is expected. Record the task ARN and log group. The task's absolute deadline and existing idempotency token must be preserved when reconciling any uncertain launch response.
6. Observe the exact task and run `renderer-inspect.sql`. Successful acceptance requires the durable clip `ready`, job `done`, four current-lease Storage objects and zero publications. The worker's validated manifest must contain horizontal 1280×720, vertical 720×1280, thumbnail and captions, with video duration 2,000 ms ±150 ms. Logs must show a `ready` drain, followed by a normal finite stop. A task that never reached the broker or only reports `idle` does not pass this rendering test.

Do not create a second fixture to hide a failure. Read the first job's finite error code, correct that cause and use the existing retry path only after its authority and state remain valid. Keep broker secrets, upload/source grants and arbitrary raw errors out of receipts.

## Exact cleanup

After that task is stopped and no fixture lease is active, execute `renderer-cleanup.sql`. It verifies the marker, exact synthetic actor/session, one isolated session and zero publications before deleting the fixture. Existing deletion triggers schedule the four exact output names after the signed-upload capability window; the recipe preserves the 2-hour-10-minute cleanup delay. Record pending cleanup honestly and leave the scheduler able to drain it when due.

Delete only the five exact S3 source object versions saved in step 2. Record each deletion result; do not use a bucket-wide or prefix-wide delete. The SQL cannot remove AWS objects. Later confirm the four private output cleanup rows are done and their exact objects absent. Do not shorten the cleanup delay or reset the launch ledger.

If acceptance fails before operational activation, restore clip admission to disabled with the same origin/max_active and keep an unverified schedule disabled. If accepted, leave the root-approved renderer activation intact while removing the fixture; cleanup must not turn off an accepted service accidentally.

This single synthetic job proves the production queue/worker/storage completion path and, when launched by the tick, the scheduler. It does not establish real Daily broadcasting, long-clip capacity, native-device behavior or five-million-user load capacity.
