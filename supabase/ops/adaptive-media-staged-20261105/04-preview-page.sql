-- This service-only preview never admits jobs or changes feature gates.
-- Replace NULL with the previous nextAfterId until hasMore is false.
with authority as materialized (
  select set_config('request.jwt.claims', '{"role":"service_role"}', true) as claims
)
select public.backfill_media_renditions_v2(null, 100, true) as preview
from authority where claims <> '';
