-- Existing clients and rows use a text[] of ordered photos.
set local lock_timeout = '2s';
alter table public.marketplace_listings
  add constraint marketplace_listings_max_ten_photos
  check (cardinality(images) <= 10) not valid;
