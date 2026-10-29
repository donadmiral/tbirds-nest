-- Keep the legacy save signature for installed clients and existing-draft edits.
-- New clients create drafts through an atomic request receipt, so a response
-- lost in transit cannot create another scheduled post on retry.
create table marketplace_ops.studio_draft_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_key uuid not null,
  payload jsonb not null,
  draft_id uuid references public.studio_scheduled_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_key)
);
alter table marketplace_ops.studio_draft_requests enable row level security;
revoke all on marketplace_ops.studio_draft_requests from public, anon, authenticated, service_role;

-- Definer access is required only for the private receipt and the existing
-- server-owned Studio save. Every replay rechecks the current authenticated
-- user and their current Studio publishing role before looking up a receipt.
create function public.studio_save_post_once(
  p_expected_user uuid,
  p_request_key uuid,
  p_content text default null,
  p_body text default null,
  p_category text default null,
  p_community uuid default null,
  p_media jsonb default '[]'::jsonb,
  p_products jsonb default '[]'::jsonb,
  p_publish_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  request_payload jsonb;
  prior marketplace_ops.studio_draft_requests;
  saved_id uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if actor is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED' using errcode = '42501'; end if;
  perform public.studio_require(array['owner', 'admin', 'editor']);
  if p_request_key is null then raise exception 'REQUEST_KEY_REQUIRED' using errcode = '22023'; end if;

  request_payload := jsonb_build_object(
    'content', p_content, 'body', p_body, 'category', p_category,
    'community', p_community, 'media', coalesce(p_media, '[]'::jsonb),
    'products', coalesce(p_products, '[]'::jsonb), 'publish_at', p_publish_at
  );
  if octet_length(request_payload::text) > 1048576 then raise exception 'DRAFT_TOO_LARGE' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('studio-draft:' || actor::text || ':' || p_request_key::text, 0));
  select * into prior from marketplace_ops.studio_draft_requests where actor_id = actor and request_key = p_request_key;
  if found then
    if prior.payload is distinct from request_payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023'; end if;
    if prior.draft_id is null or not exists (
      select 1 from public.studio_scheduled_posts where id = prior.draft_id and owner_id = actor
    ) then raise exception 'SAVED_DRAFT_REMOVED' using errcode = 'P0002'; end if;
    return prior.draft_id;
  end if;

  saved_id := public.studio_save_post(null, p_content, p_body, p_category, p_community, coalesce(p_media, '[]'::jsonb), coalesce(p_products, '[]'::jsonb), p_publish_at);
  if saved_id is null then raise exception 'DRAFT_SAVE_NOT_CONFIRMED'; end if;
  insert into marketplace_ops.studio_draft_requests(actor_id, request_key, payload, draft_id)
  values (actor, p_request_key, request_payload, saved_id);
  return saved_id;
end $$;

revoke all on function public.studio_save_post_once(uuid, uuid, text, text, text, uuid, jsonb, jsonb, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.studio_save_post_once(uuid, uuid, text, text, text, uuid, jsonb, jsonb, timestamptz) to authenticated;
