-- One author-selected comment per post. Existing reactions supply "Liked by author".
-- Direct callers can read a visible pin, but only this checked command writes it.
create schema if not exists social_ops;
revoke all on schema social_ops from public, anon;
grant usage on schema social_ops to authenticated;

create table if not exists public.post_comment_pins (
  post_id uuid primary key references public.posts(id) on delete cascade,
  comment_id uuid not null unique references public.post_comments(id) on delete cascade,
  pinned_by uuid references public.profiles(id) on delete set null,
  pinned_at timestamptz not null default now()
);
alter table public.post_comment_pins enable row level security;
revoke all on table public.post_comment_pins from public, anon, authenticated;
grant select on table public.post_comment_pins to authenticated;
create policy post_comment_pins_visible on public.post_comment_pins
  for select to authenticated using (
    public.can_view_post(post_id) and exists (
      select 1 from public.post_comments c join public.posts p on p.id=c.post_id
      where c.id=comment_id and c.post_id=post_comment_pins.post_id
        and (c.hidden_at is null or c.user_id=auth.uid() or p.user_id=auth.uid())
        and (not coalesce(c.is_spam,false) or c.user_id=auth.uid() or p.user_id=auth.uid())
    )
  );

create or replace function social_ops.set_comment_pinned(p_comment_id uuid, p_pinned boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_comment public.post_comments%rowtype;
  v_owner uuid;
  v_post_id uuid;
begin
  if v_me is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  if p_pinned is null then raise exception 'Choose pin or unpin'; end if;
  select * into v_comment from public.post_comments where id=p_comment_id;
  if not found then raise exception 'Comment unavailable'; end if;
  v_post_id := v_comment.post_id;
  -- Serialize changes for this post, including two concurrent pin requests.
  select user_id into v_owner from public.posts where id=v_post_id for update;
  if not coalesce(public.can_act_as(v_owner),false) then
    raise exception 'Only the post author can pin comments' using errcode='42501';
  end if;
  -- Re-read under a row lock after the post lock, in the same order as
  -- comment deletion/count maintenance. A moderation or move cannot race
  -- the eligibility check using the earlier snapshot.
  select * into v_comment from public.post_comments where id=p_comment_id and post_id=v_post_id for update;
  if not found then raise exception 'Comment unavailable'; end if;
  if p_pinned then
    if v_comment.parent_comment_id is not null then raise exception 'Pin a top-level comment'; end if;
    if v_comment.hidden_at is not null or coalesce(v_comment.is_spam,false) then
      raise exception 'Unhide and approve this comment before pinning it';
    end if;
    insert into public.post_comment_pins(post_id,comment_id,pinned_by,pinned_at)
    values(v_comment.post_id,v_comment.id,v_me,now())
    on conflict(post_id) do update set comment_id=excluded.comment_id,pinned_by=excluded.pinned_by,pinned_at=excluded.pinned_at;
  else
    delete from public.post_comment_pins where post_id=v_comment.post_id and comment_id=v_comment.id;
  end if;
  return jsonb_build_object('pinned_comment_id', (select comment_id from public.post_comment_pins where post_id=v_comment.post_id));
end;
$$;
revoke all on function social_ops.set_comment_pinned(uuid,boolean) from public,anon,authenticated;
grant execute on function social_ops.set_comment_pinned(uuid,boolean) to authenticated;

create or replace function public.set_comment_pinned(p_comment_id uuid,p_pinned boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select social_ops.set_comment_pinned(p_comment_id,p_pinned);
$$;
revoke all on function public.set_comment_pinned(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_comment_pinned(uuid,boolean) to authenticated;
notify pgrst, 'reload schema';
