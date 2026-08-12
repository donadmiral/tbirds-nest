-- 0122: trg_voip_ring was absent from the live database even though 0119
-- created it and was recorded as applied. Recreate it against the
-- vault-reading notify_voip_ring from 0121. Idempotent.
drop trigger if exists trg_voip_ring on public.call_participants;
create trigger trg_voip_ring
  after insert on public.call_participants
  for each row execute function public.notify_voip_ring();