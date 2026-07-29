-- 0103 Trust controls, four at once.
-- 1 Referrals: verified members vouch for applications; the queue sorts by them.
-- 2 Business gating: a business account cannot sell until it wears space grey.
-- 3 Blocked words: a trigger refuses violating posts and comments at the door.
-- (4 Role-scoped desks is code-side, no schema.)

create table if not exists public.verification_referrals (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.verification_applications(id) on delete cascade,
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  note text,
  created_at timestamp with time zone not null default now(),
  unique (application_id, referrer_id)
);
alter table public.verification_referrals enable row level security;
drop policy if exists "referrals_insert_verified" on public.verification_referrals;
create policy "referrals_insert_verified" on public.verification_referrals
  for insert to authenticated
  with check (
    auth.uid() = referrer_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_verified = true)
  );
drop policy if exists "referrals_read_all" on public.verification_referrals;
create policy "referrals_read_all" on public.verification_referrals
  for select to authenticated using (true);

drop policy if exists "business_needs_grey_to_sell" on public.marketplace_listings;
create policy "business_needs_grey_to_sell" on public.marketplace_listings
  as restrictive for insert
  with check (
    (select account_type from public.profiles where id = auth.uid()) is distinct from 'business'
    or (select verified_tier from public.profiles where id = auth.uid()) in ('business', 'official')
  );

create table if not exists public.blocked_words (
  word text primary key,
  added_by uuid,
  created_at timestamp with time zone not null default now()
);
alter table public.blocked_words enable row level security;

create or replace function public.contains_blocked(p_text text)
returns boolean language sql stable security definer set search_path = public
as $fn$
  select exists (
    select 1 from blocked_words w
    where p_text is not null and p_text ilike '%' || w.word || '%'
  );
$fn$;

create or replace function public.refuse_blocked_content()
returns trigger language plpgsql security definer set search_path = public
as $fn$
begin
  if public.contains_blocked(coalesce(new.content, '') || ' ' || coalesce(new.body, '')) then
    raise exception 'This content contains language that is not allowed on Platinum Circles.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists posts_block_words on public.posts;
create trigger posts_block_words
  before insert or update on public.posts
  for each row execute function public.refuse_blocked_content();

drop trigger if exists comments_block_words on public.post_comments;
create trigger comments_block_words
  before insert or update on public.post_comments
  for each row execute function public.refuse_blocked_content();