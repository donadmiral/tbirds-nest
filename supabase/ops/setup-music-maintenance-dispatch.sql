-- Public deployment metadata only. First verify the exact ACTIVE Edge bundle.
-- Set these transaction-local settings to the reviewed project's HTTPS origin
-- and the verified music-maintenance source bundle SHA256 before this statement.
-- This does not activate maintenance or uploads and creates no reusable secret.
begin;
select music_library.configure_maintenance_dispatch(
 current_setting('platinum.maintenance_project_origin',true),
 current_setting('platinum.maintenance_worker_sha256',true)
);
commit;
