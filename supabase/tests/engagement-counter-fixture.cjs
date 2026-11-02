const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../reference/live-schema-20261017.sql'), 'utf8');
const functions = [
  'sync_post_likes_count_exact', 'update_comment_count', 'update_comments_count',
  'sync_post_comment_count', 'sync_post_comments_count', 'sync_post_reposts_count',
  'sync_post_bookmark_count', 'sync_post_bookmarks_count', 'sync_post_counter_exact',
  'notify_on_like', 'notify_on_post_comment', 'notify_on_repost', 'toggle_post_like',
];
const capturedFunctions = functions.map(name => {
  const start = source.indexOf(`CREATE FUNCTION "public"."${name}"(`);
  if (start < 0) throw new Error('Missing captured function ' + name);
  const end = source.indexOf('$qa_source$;', source.indexOf('AS $qa_source$', start)) + '$qa_source$;'.length;
  return source.slice(start, end);
}).join('\n');
const capturedTriggers = source.split('\n').filter(line => line.startsWith('CREATE TRIGGER ')
  && / ON public\.post_(likes|comments|reposts|bookmarks) /.test(line)
  && functions.some(name => line.includes('FUNCTION ' + name + '()'))).join('\n');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261102062139_post_engagement_delta_counters.sql'), 'utf8');
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const P1 = id(1), P2 = id(2), OWNER = id(100), VIEWER = id(101);
const fixture = `
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
create table members(id uuid primary key);
insert into members select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(100,10100) n;
create table posts(id uuid primary key, user_id uuid references members(id), content text, body text,
  likes_count integer default 0, comments_count integer default 0, reposts_count integer default 0,
  bookmarks_count integer default 0, views_count integer default 0);
create table post_likes(id uuid primary key default gen_random_uuid(),post_id uuid not null references posts on delete cascade,
  user_id uuid not null references members on delete cascade, created_at timestamptz default now(), unique(post_id,user_id));
create table post_comments(id uuid primary key default gen_random_uuid(), post_id uuid not null references posts on delete cascade,
  user_id uuid not null references members on delete cascade, parent_comment_id uuid references post_comments on delete cascade,
  body text default '',content text, hidden_at timestamptz,is_spam boolean default false);
create table post_reposts(id uuid primary key default gen_random_uuid(),post_id uuid not null references posts on delete cascade,
  user_id uuid not null references members on delete cascade, created_at timestamptz default now(), unique(post_id,user_id));
create table post_bookmarks(id uuid primary key default gen_random_uuid(),post_id uuid references posts on delete cascade,
  user_id uuid references members on delete cascade, created_at timestamp default now(), unique(post_id,user_id));
create table notifications(id bigint generated always as identity,recipient_id uuid,actor_id uuid,type text,message text,data jsonb,body_preview text);
create table counter_write_log(post_id uuid, before_row jsonb, after_row jsonb);
create function log_counter_write() returns trigger language plpgsql set search_path='' as $$begin
  insert into public.counter_write_log values(new.id,to_jsonb(old),to_jsonb(new)); return null; end$$;
create trigger test_log_counter_write after update on posts for each row execute function log_counter_write();
${capturedFunctions}
${capturedTriggers}
insert into posts(id,user_id,content,views_count) values('${P1}','${OWNER}','Existing post',37),('${P2}','${OWNER}','Another post',41);
insert into post_likes(post_id,user_id) values('${P1}','${VIEWER}');
insert into post_reposts(post_id,user_id) values('${P1}','${VIEWER}');
insert into post_bookmarks(post_id,user_id) values('${P1}','${VIEWER}');
insert into post_comments(id,post_id,user_id) values('${id(10)}','${P1}','${VIEWER}');
insert into post_comments(id,post_id,user_id,parent_comment_id,hidden_at,is_spam)
 values('${id(11)}','${P1}','${VIEWER}','${id(10)}',now(),true);
-- Start deliberately drifted, as can happen with the previous concurrent recounts.
update posts set likes_count=97,comments_count=98,reposts_count=99,bookmarks_count=null;
truncate counter_write_log,notifications;
alter table posts enable row level security;
create policy posts_read on posts for select to authenticated using(true);
create policy posts_insert on posts for insert to authenticated with check(user_id=auth.uid());
create policy posts_update on posts for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update on posts to authenticated;
grant select on members to authenticated;
do $$ declare t text; begin foreach t in array array['post_likes','post_comments','post_reposts','post_bookmarks'] loop
 execute format('alter table %I enable row level security',t);
 execute format('create policy own_write on %I for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid())',t);
 execute format('grant select,insert,update,delete on %I to authenticated',t);
end loop; end$$;
-- The fixture logger runs as its owner so it cannot interfere with member RLS.
alter function log_counter_write() security definer;
`;
module.exports = { fixture, migration, id, P1, P2, OWNER, VIEWER };
