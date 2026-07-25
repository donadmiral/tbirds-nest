-- 0007_comment_reactions.sql
-- One reaction table with a signed value instead of parallel like/dislike
-- tables. A like is 1, a dislike is -1, the existing unique constraint on
-- (comment_id, user_id) enforces one reaction per person, and weighted or
-- emoji reactions later cost a widened check constraint instead of a rewrite.
--
-- Also fixes: nothing maintained post_comments.likes_count. notify_on_comment_like
-- only wrote a notification and there was no counter trigger, so every read of
-- that column was reading a stale zero.

alter table if exists public.comment_likes rename to comment_reactions;

alter table public.comment_reactions
  add column if not exists value smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.comment_reactions'::regclass
                   and conname = 'comment_reactions_value_check') then
    alter table public.comment_reactions
      add constraint comment_reactions_value_check check (value in (-1, 1));
  end if;
end $$;

alter table public.post_comments
  add column if not exists dislikes_count integer not null default 0;

drop policy if exists comment_reactions_update_own on public.comment_reactions;
create policy comment_reactions_update_own on public.comment_reactions
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Compatibility view: existing app code reads and writes comment_likes and
-- keeps working untouched. security_invoker keeps RLS on the base table.
-- Dropped once PostScreen moves to set_comment_reaction.
create or replace view public.comment_likes
  with (security_invoker = true) as
  select id, comment_id, user_id, created_at
  from public.comment_reactions
  where value = 1;

create or replace function public.sync_comment_reaction_counts()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_comment uuid;
begin
  v_comment := coalesce(new.comment_id, old.comment_id);
  update post_comments c
     set likes_count    = (select count(*) from comment_reactions r
                            where r.comment_id = v_comment and r.value = 1),
         dislikes_count = (select count(*) from comment_reactions r
                            where r.comment_id = v_comment and r.value = -1)
   where c.id = v_comment;
  return null;
end;
$fn$;

drop trigger if exists trg_sync_comment_reaction_counts on public.comment_reactions;
create trigger trg_sync_comment_reaction_counts
after insert or update or delete on public.comment_reactions
for each row execute function public.sync_comment_reaction_counts();

update post_comments c
   set likes_count    = coalesce((select count(*) from comment_reactions r
                                   where r.comment_id = c.id and r.value = 1), 0),
       dislikes_count = coalesce((select count(*) from comment_reactions r
                                   where r.comment_id = c.id and r.value = -1), 0);

-- Notify on a like only. A dislike is private and must never ping the author.
create or replace function public.notify_on_comment_like()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_author uuid; v_body text; v_post uuid; v_liker text;
begin
  if new.value <> 1 then return new; end if;
  select user_id, coalesce(body, content, ''), post_id
    into v_author, v_body, v_post
  from post_comments where id = new.comment_id;
  if v_author is null or v_author = new.user_id then return new; end if;
  select full_name into v_liker from profiles where id = new.user_id;
  insert into notifications (recipient_id, actor_id, type, message, body_preview, data)
  values (v_author, new.user_id, 'comment_like',
          coalesce(v_liker, 'Someone') || ' liked your comment',
          left(v_body, 80),
          jsonb_build_object('comment_id', new.comment_id, 'post_id', v_post));
  return new;
end;
$fn$;

-- One call for the whole interaction: tapping the same reaction clears it,
-- tapping the other flips it, and the current counts come back with the result.
create or replace function public.set_comment_reaction(p_comment_id uuid, p_value smallint)
returns jsonb language plpgsql security invoker set search_path = public as $fn$
declare
  v_me uuid := auth.uid();
  v_existing smallint;
  v_final smallint;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_value not in (-1, 1) then raise exception 'value must be 1 or -1'; end if;

  select value into v_existing from comment_reactions
  where comment_id = p_comment_id and user_id = v_me;

  if v_existing is null then
    insert into comment_reactions (comment_id, user_id, value)
    values (p_comment_id, v_me, p_value);
    v_final := p_value;
  elsif v_existing = p_value then
    delete from comment_reactions where comment_id = p_comment_id and user_id = v_me;
    v_final := 0;
  else
    update comment_reactions set value = p_value
    where comment_id = p_comment_id and user_id = v_me;
    v_final := p_value;
  end if;

  return jsonb_build_object(
    'value', v_final,
    'likes',    (select likes_count    from post_comments where id = p_comment_id),
    'dislikes', (select dislikes_count from post_comments where id = p_comment_id)
  );
end;
$fn$;

grant execute on function public.set_comment_reaction(uuid, smallint) to authenticated;