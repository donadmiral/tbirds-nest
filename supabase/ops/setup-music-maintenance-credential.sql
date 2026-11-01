-- Retired: a reusable worker credential must never enter a readable pg_net queue.
-- Install the one-use dispatch migration and use setup-music-maintenance-dispatch.sql.
do $$ begin
 raise exception 'MUSIC_REUSABLE_WORKER_CREDENTIAL_RETIRED: use verified one-use dispatch configuration';
end $$;
