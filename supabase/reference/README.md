# Live schema reference

`live-schema-20261017.sql` is a schema-only capture of the production Platinum
Circles database (project `prlkikhckbifseosbukl`) taken on 17 October 2026 and
used to bootstrap the isolated QA project (`uaulhuelcfkjwojtymmw`).

It is a read-only reference: 156 table definitions and 403 function definitions from that capture,
including many functions that were created in the SQL editor and never
recorded in `supabase/migrations`. Read it to learn the real columns, function
signatures, grants and RLS policies before writing a migration or an RPC call.

Do not run it. It is not a migration, it excludes data, auth identities,
storage buckets, vault secrets, cron schedules and hooks, and it must never be
applied to a populated database.

Migrations recorded after 17 October 2026 are not reflected here; read the
files in `supabase/migrations` dated `20261017` and later alongside it.
