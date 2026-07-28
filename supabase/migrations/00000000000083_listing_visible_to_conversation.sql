-- 0083 A sold or paused listing stays readable to anyone who has a market
-- conversation about it. Without this, the buyer's chat banner and the
-- listing page both go blank the moment the seller marks it sold.

create policy listings_select_conversation on public.marketplace_listings
as permissive for select to authenticated
using (
  exists (
    select 1 from conversations c
    where c.context = 'market'
      and c.context_ref_id = marketplace_listings.id
      and (c.user_1 = auth.uid() or c.user_2 = auth.uid())
  )
);

create index if not exists idx_conversations_ctx_ref
on public.conversations (context_ref_id)
where context_ref_id is not null;