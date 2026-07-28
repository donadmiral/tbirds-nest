-- 0074: Market offers. An offer is a row with a lifecycle plus a message
-- card in the market thread — the same pattern payments proved.

create table if not exists public.listing_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references marketplace_listings(id) on delete cascade,
  buyer_id uuid not null references profiles(id) on delete cascade,
  seller_id uuid not null references profiles(id) on delete cascade,
  proposer_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined','countered','withdrawn')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
alter table public.listing_offers enable row level security;
drop policy if exists offers_select_participants on public.listing_offers;
create policy offers_select_participants on public.listing_offers
  for select to authenticated using (auth.uid() in (buyer_id, seller_id));
-- writes happen only through the definer rpcs below

alter table public.messages drop constraint if exists messages_media_type_check;
alter table public.messages add constraint messages_media_type_check
  check (media_type = any (array['image','video','gif','audio','link','document','call_event','payment','sticker','offer']::text[]));

create or replace function public.make_offer(p_listing_id uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public
as $fn$
declare v_l record; v_conv uuid; v_offer uuid; v_meta text;
begin
  select id, seller_id, title, currency, status into v_l
  from marketplace_listings where id = p_listing_id;
  if v_l.id is null then raise exception 'listing not found'; end if;
  if v_l.status <> 'available' then raise exception 'listing is no longer available'; end if;
  if v_l.seller_id = auth.uid() then raise exception 'cannot offer on your own listing'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;

  insert into listing_offers (listing_id, buyer_id, seller_id, proposer_id, amount, currency)
  values (p_listing_id, auth.uid(), v_l.seller_id, auth.uid(), p_amount, v_l.currency)
  returning id into v_offer;

  select start_dm_ctx(v_l.seller_id, 'market', p_listing_id) into v_conv;

  v_meta := jsonb_build_object('offer_id', v_offer, 'listing_id', p_listing_id,
    'listing_title', v_l.title, 'amount', p_amount, 'currency', v_l.currency,
    'status', 'pending')::text;
  insert into messages (conversation_id, sender_id, receiver_id, text, media_type, media_url)
  values (v_conv, auth.uid(), v_l.seller_id,
    'Offer: ' || v_l.currency || ' ' || p_amount::text || ' for ' || v_l.title,
    'offer', v_meta);
  return v_offer;
end $fn$;

create or replace function public.respond_offer(p_offer_id uuid, p_action text, p_counter_amount numeric default null)
returns void language plpgsql security definer set search_path = public
as $fn$
declare v_o record; v_conv uuid; v_meta text; v_other uuid; v_new uuid;
begin
  select * into v_o from listing_offers where id = p_offer_id;
  if v_o.id is null then raise exception 'offer not found'; end if;
  if v_o.status <> 'pending' then raise exception 'offer already resolved'; end if;
  if auth.uid() not in (v_o.buyer_id, v_o.seller_id) then raise exception 'not your offer'; end if;
  if p_action = 'withdrawn' and auth.uid() <> v_o.proposer_id then raise exception 'only the proposer withdraws'; end if;
  if p_action in ('accepted','declined','countered') and auth.uid() = v_o.proposer_id then
    raise exception 'the other side responds to this offer';
  end if;
  if p_action not in ('accepted','declined','countered','withdrawn') then raise exception 'bad action'; end if;

  update listing_offers set status = p_action, responded_at = now() where id = p_offer_id;

  v_other := case when auth.uid() = v_o.buyer_id then v_o.seller_id else v_o.buyer_id end;
  select start_dm_ctx(v_other, 'market', v_o.listing_id) into v_conv;

  if p_action = 'countered' then
    if p_counter_amount is null or p_counter_amount <= 0 then raise exception 'counter needs an amount'; end if;
    insert into listing_offers (listing_id, buyer_id, seller_id, proposer_id, amount, currency)
    values (v_o.listing_id, v_o.buyer_id, v_o.seller_id, auth.uid(), p_counter_amount, v_o.currency)
    returning id into v_new;
    v_meta := jsonb_build_object('offer_id', v_new, 'listing_id', v_o.listing_id,
      'listing_title', (select title from marketplace_listings where id = v_o.listing_id),
      'amount', p_counter_amount, 'currency', v_o.currency, 'status', 'pending',
      'counter_of', p_offer_id)::text;
    insert into messages (conversation_id, sender_id, receiver_id, text, media_type, media_url)
    values (v_conv, auth.uid(), v_other,
      'Counter-offer: ' || v_o.currency || ' ' || p_counter_amount::text, 'offer', v_meta);
  else
    insert into messages (conversation_id, sender_id, receiver_id, text, media_type, is_system_message)
    values (v_conv, auth.uid(), v_other,
      case p_action when 'accepted' then '✅ Offer accepted'
                    when 'declined' then 'Offer declined'
                    else 'Offer withdrawn' end, null, true);
  end if;
end $fn$;

grant execute on function public.make_offer(uuid, numeric) to authenticated;
grant execute on function public.respond_offer(uuid, text, numeric) to authenticated;