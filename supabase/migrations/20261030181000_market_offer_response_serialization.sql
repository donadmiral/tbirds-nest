-- Preserve the installed response signature. A repeated or competing response
-- must refresh the offer; this contract deliberately does not replay mutations.
begin;
set local lock_timeout='3s';

do $preflight$
begin
 if not exists (
  select 1 from pg_proc
  where oid=to_regprocedure('public.respond_offer(uuid,text,numeric)')
   and pg_get_userbyid(proowner)='postgres'
   and md5(pg_get_functiondef(oid))='ff552c77266afb38f9674d912028fb35'
 ) then
  raise exception 'OFFER_RESPONSE_BASELINE_DRIFT';
 end if;
 if to_regprocedure('public.offer_response_capabilities()') is not null then
  raise exception 'OFFER_RESPONSE_CAPABILITY_ALREADY_EXISTS';
 end if;
 if exists (
  select 1 from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid='public.respond_offer(uuid,text,numeric)'::regprocedure
   and a.grantee not in (0,
    (select oid from pg_roles where rolname='postgres'),
    (select oid from pg_roles where rolname='anon'),
    (select oid from pg_roles where rolname='authenticated'),
    (select oid from pg_roles where rolname='service_role'))
 ) then
  raise exception 'OFFER_RESPONSE_UNREVIEWED_GRANT';
 end if;
end $preflight$;

create function public.offer_response_capabilities() returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
 v_actor uuid:=auth.uid();
 v_session uuid;
 v_account_type text;
 v_business_allowed boolean;
begin
 if v_actor is null or auth.role() is distinct from 'authenticated'
  or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
  raise exception 'OFFER_SESSION_REQUIRED' using errcode='42501';
 end if;
 begin
  v_session:=(auth.jwt()->>'session_id')::uuid;
 exception when invalid_text_representation then
  raise exception 'OFFER_SESSION_REQUIRED' using errcode='42501';
 end;
 if not exists (
  select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=v_session and s.user_id=v_actor
   and (s.not_after is null or s.not_after>clock_timestamp())
   and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
 ) then
  raise exception 'OFFER_SESSION_REQUIRED' using errcode='42501';
 end if;
 select p.account_type into v_account_type from public.profiles p
 where p.id=v_actor and p.deactivated_at is null
  and (p.restricted_until is null or p.restricted_until<=clock_timestamp());
 if not found then
  raise exception 'OFFER_ACCOUNT_UNAVAILABLE' using errcode='42501';
 end if;

 -- Keep the current business session fence when installed. Until that
 -- installation is verified, a business identity cannot use this new contract.
 if to_regprocedure('public.business_session_allowed()') is not null then
  execute 'select public.business_session_allowed()' into v_business_allowed;
  if v_business_allowed is distinct from true then
   raise exception 'BUSINESS_SESSION_REQUIRED' using errcode='42501';
  end if;
 elsif v_account_type='business' then
  raise exception 'BUSINESS_SESSION_REQUIRED' using errcode='42501';
 end if;
 return jsonb_build_object('version',1,'serialized',true,'replay',false,
  'fractionDigits',2,'maxAmount','9999999999.99');
end $fn$;
revoke all on function public.offer_response_capabilities() from public,anon,authenticated,service_role;
grant execute on function public.offer_response_capabilities() to authenticated;

create or replace function public.respond_offer(
 p_offer_id uuid,p_action text,p_counter_amount numeric default null
) returns void language plpgsql security definer set search_path='' as $fn$
declare
 v_actor uuid:=auth.uid();
 v_offer public.listing_offers%rowtype;
 v_conversation uuid;
 v_other uuid;
 v_new uuid;
 v_meta text;
begin
 perform public.offer_response_capabilities();
 if p_offer_id is null or p_action is null
  or p_action not in ('accepted','declined','countered','withdrawn') then
  raise exception 'OFFER_INVALID_ACTION' using errcode='22023';
 end if;
 if p_action='countered' then
  if p_counter_amount is null or p_counter_amount::text in ('NaN','Infinity','-Infinity')
   or p_counter_amount<=0 or p_counter_amount>9999999999.99
   or p_counter_amount<>trunc(p_counter_amount,2) then
   raise exception 'OFFER_INVALID_AMOUNT' using errcode='22023';
  end if;
 elsif p_counter_amount is not null then
  raise exception 'OFFER_UNEXPECTED_AMOUNT' using errcode='22023';
 end if;

 -- Acquire the installed erasure fence before the row lock, matching the
 -- actor-write trigger's lock order. This adds no claim of an absent workflow.
 if to_regprocedure('account_erasure.assert_writable(uuid)') is not null then
  execute 'select account_erasure.assert_writable($1)' using v_actor;
 end if;

 -- The waiting transaction reads the winning transaction's resolved state.
 -- Nonparticipants neither observe nor lock another account's offer.
 select o.* into v_offer from public.listing_offers o
 where o.id=p_offer_id and v_actor in (o.buyer_id,o.seller_id)
 for update;
 if not found then
  raise exception 'OFFER_NOT_FOUND' using errcode='P0002';
 end if;
 -- A session can be revoked while this request waits for the offer lock.
 perform public.offer_response_capabilities();
 if v_offer.buyer_id=v_offer.seller_id
  or v_offer.proposer_id not in (v_offer.buyer_id,v_offer.seller_id) then
  raise exception 'OFFER_INVALID_PARTICIPANTS' using errcode='42501';
 end if;
 if (p_action='withdrawn' and v_actor<>v_offer.proposer_id)
  or (p_action in ('accepted','declined','countered') and v_actor=v_offer.proposer_id) then
  raise exception 'OFFER_RESPONSE_FORBIDDEN' using errcode='42501';
 end if;
 if v_offer.status<>'pending' then
  raise exception 'OFFER_ALREADY_RESOLVED' using errcode='55000';
 end if;
 if p_action='countered' and v_offer.currency not in ('USD','ZWG') then
  raise exception 'OFFER_UNSUPPORTED_CURRENCY' using errcode='22023';
 end if;

 update public.listing_offers set status=p_action,responded_at=clock_timestamp()
 where id=p_offer_id and status='pending';
 if not found then
  raise exception 'OFFER_ALREADY_RESOLVED' using errcode='55000';
 end if;
 v_other:=case when v_actor=v_offer.buyer_id then v_offer.seller_id else v_offer.buyer_id end;
 v_conversation:=public.start_dm_ctx(v_other,'market',v_offer.listing_id);
 if v_conversation is null then
  raise exception 'OFFER_CONVERSATION_UNAVAILABLE';
 end if;
 if p_action='countered' then
  insert into public.listing_offers(listing_id,buyer_id,seller_id,proposer_id,amount,currency)
  values(v_offer.listing_id,v_offer.buyer_id,v_offer.seller_id,v_actor,p_counter_amount,v_offer.currency)
  returning id into v_new;
  v_meta:=jsonb_build_object('offer_id',v_new,'listing_id',v_offer.listing_id,
   'listing_title',(select title from public.marketplace_listings where id=v_offer.listing_id),
   'amount',p_counter_amount,'currency',v_offer.currency,'status','pending','counter_of',p_offer_id)::text;
  insert into public.messages(conversation_id,sender_id,receiver_id,text,media_type,media_url)
  values(v_conversation,v_actor,v_other,
   'Counter-offer: '||v_offer.currency||' '||p_counter_amount::text,'offer',v_meta);
 else
  insert into public.messages(conversation_id,sender_id,receiver_id,text,media_type,is_system_message)
  values(v_conversation,v_actor,v_other,
   case p_action when 'accepted' then '✅ Offer accepted'
    when 'declined' then 'Offer declined' else 'Offer withdrawn' end,null,true);
 end if;
end $fn$;
revoke all on function public.respond_offer(uuid,text,numeric) from public,anon,authenticated,service_role;
grant execute on function public.respond_offer(uuid,text,numeric) to authenticated;
comment on function public.respond_offer(uuid,text,numeric) is
 'Serialized participant-only offer response. No request replay: refresh after an ambiguous or already-resolved result.';

commit;
