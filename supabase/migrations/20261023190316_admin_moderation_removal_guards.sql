-- Moderation must survive owner edits, deletions, and re-use of old content ids.
-- Captured from the same atomic audit insert as the admin command.
create table admin_ops.removals (
 kind text not null check(kind in ('post','story','comment','listing')),
 content_id uuid not null, audit_id uuid not null,
 removed_at timestamptz not null default now(), primary key(kind,content_id)
);
alter table admin_ops.removals enable row level security;
revoke all on admin_ops.removals from public,anon,authenticated,service_role;

create or replace function admin_ops.capture_removal() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind_value text; id_value uuid;
begin
 case new.action
 when 'adminRemovePost' then kind_value:='post';id_value:=(new.before->>'id')::uuid;
 when 'removeReportedPost' then kind_value:='post';id_value:=(new.before->>'post_id')::uuid;
 when 'adminRemoveStory' then kind_value:='story';id_value:=(new.before->>'id')::uuid;
 when 'adminRemoveComment' then kind_value:='comment';id_value:=(new.before->>'id')::uuid;
 when 'adminRemoveListing' then kind_value:='listing';id_value:=(new.before->>'id')::uuid;
 when 'removeReportedListing' then kind_value:='listing';id_value:=(new.before->>'listing_id')::uuid;
 else return new;
 end case;
 if id_value is not null then
  insert into admin_ops.removals(kind,content_id,audit_id,removed_at)
   values(kind_value,id_value,new.id,new.created_at) on conflict(kind,content_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function admin_ops.capture_removal() from public,anon,authenticated,service_role;
create trigger capture_admin_removal after insert on public.admin_audit_log
 for each row execute function admin_ops.capture_removal();

insert into admin_ops.removals(kind,content_id,audit_id,removed_at)
select kind,content_id::uuid,id,created_at from (
 select id,created_at,
  case action when 'adminRemovePost' then 'post' when 'removeReportedPost' then 'post'
   when 'adminRemoveStory' then 'story' when 'adminRemoveComment' then 'comment'
   when 'adminRemoveListing' then 'listing' when 'removeReportedListing' then 'listing' end kind,
  case action when 'removeReportedPost' then before->>'post_id' when 'removeReportedListing' then before->>'listing_id' else before->>'id' end content_id
 from public.admin_audit_log
 where action in ('adminRemovePost','removeReportedPost','adminRemoveStory','adminRemoveComment','adminRemoveListing','removeReportedListing')
) evidence where content_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
order by created_at,id on conflict(kind,content_id) do nothing;

create or replace function admin_ops.guard_removed_content() returns trigger
language plpgsql security definer set search_path='' as $$
declare id_value uuid; kind_value text;
begin
 -- Only trusted service workers may perform a separately reviewed restoration.
 -- A SECURITY DEFINER user RPC still carries the authenticated JWT role here.
 if coalesce(auth.role(),'')='service_role' then return coalesce(new,old); end if;
 kind_value:=case tg_table_name when 'posts' then 'post' when 'stories' then 'story'
  when 'post_comments' then 'comment' when 'marketplace_listings' then 'listing' end;
 if tg_op='INSERT' then id_value:=new.id;else id_value:=old.id;end if;
 if exists(select 1 from admin_ops.removals where kind=kind_value and content_id=id_value) then
  if tg_op='INSERT' or tg_op='DELETE' then raise exception 'CONTENT_REMOVED_BY_MODERATOR' using errcode='42501';end if;
  if kind_value='listing' and (new.id is distinct from old.id or new.seller_id is distinct from old.seller_id
   or new.status is distinct from 'removed' or new.hidden_at is null) then
   raise exception 'CONTENT_REMOVED_BY_MODERATOR' using errcode='42501';
  end if;
 end if;
 -- Owner-created hidden rows also cannot inherit a previously removed id.
 if tg_op='UPDATE' and new.id is distinct from old.id
  and exists(select 1 from admin_ops.removals where kind=kind_value and content_id=new.id) then
  raise exception 'CONTENT_REMOVED_BY_MODERATOR' using errcode='42501';
 end if;
 return coalesce(new,old);
end $$;
revoke all on function admin_ops.guard_removed_content() from public,anon,authenticated,service_role;
create trigger admin_removed_post_guard before insert or update on public.posts
 for each row execute function admin_ops.guard_removed_content();
create trigger admin_removed_story_guard before insert or update on public.stories
 for each row execute function admin_ops.guard_removed_content();
create trigger admin_removed_comment_guard before insert or update on public.post_comments
 for each row execute function admin_ops.guard_removed_content();
create trigger admin_removed_listing_guard before insert or update or delete on public.marketplace_listings
 for each row execute function admin_ops.guard_removed_content();
