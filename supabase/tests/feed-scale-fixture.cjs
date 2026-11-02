const fs = require('node:fs');
const path = require('node:path');
const counters = require('./engagement-counter-fixture.cjs');
const source = fs.readFileSync(path.join(__dirname, '../reference/live-schema-20261017.sql'), 'utf8');
const sql = name => fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8');
function captured(name) {
  const start = source.indexOf(`CREATE FUNCTION "public"."${name}"(`);
  const end = source.indexOf('$qa_source$;', source.indexOf('AS $qa_source$', start));
  if (start < 0 || end < 0) throw Error('Missing captured function ' + name);
  return source.slice(start, end + '$qa_source$;'.length);
}
const feed = captured('get_feed');
const fixture = counters.fixture + `
alter table posts add created_at timestamptz default now(), add audience text default 'everyone',
 add community_id uuid,add archived_at timestamptz,add is_exclusive boolean default false,
 add media_url text,add link_url text,add channel text,add article_title text,add read_minutes integer,
 add innovation_field text,add innovation_stage text,add quoted_post_id uuid,add thread_parent_id uuid,add shares_count integer default 0;
alter table post_comments add created_at timestamptz default now();
create table profiles(id uuid primary key,full_name text,username text,avatar_url text,is_verified boolean default false,
 account_type text default 'personal',verified_tier text,profile_visibility text default 'public',deactivated_at timestamptz);
insert into profiles(id,full_name,username) select id,'Member '||id,'member_'||id from members;
create table follows(follower_id uuid,following_id uuid,primary key(follower_id,following_id));
create table blocked_users(blocker_id uuid,blocked_id uuid,primary key(blocker_id,blocked_id));
create table muted_authors(user_id uuid,author_id uuid,primary key(user_id,author_id));
create table hidden_posts(user_id uuid,post_id uuid,primary key(user_id,post_id));
create table post_mentions(post_id uuid,mentioned_user_id uuid,primary key(post_id,mentioned_user_id));
create table post_seen(post_id uuid,user_id uuid,primary key(post_id,user_id));
create table community_members(community_id uuid,user_id uuid);
create table trending_snapshot(kind text,ref_id uuid,rank integer,primary key(kind,ref_id));
create table marketplace_listings(id uuid primary key,status text);
create table post_products(id uuid primary key,post_id uuid,title text,subtitle text,price numeric,currency text,
 image_url text,listing_id uuid,link_url text,cta_label text,sort_order integer);
create table post_media(id uuid primary key,post_id uuid,url text,media_type text,width integer,height integer,
 sort_order integer,is_sensitive boolean,alt_text text,edit jsonb);
create table link_previews(url text primary key,title text,description text,image_url text,domain text);
${captured('can_view_post')}
${sql('20261026064639_post_media_edit_projections.sql').split('do $migration$')[0]}
drop policy posts_read on posts;
create policy posts_read on posts for select to authenticated using(archived_at is null or user_id=auth.uid());
grant select on all tables in schema public to authenticated;
${feed}
${sql('20261022211641_feed_mute_feedback.sql')}
${sql('20261022211411_feed_snapshot_visibility.sql')}
`;
const migration = sql('20261102090625_exact_feed_hydration_and_narrow_ranking.sql');
module.exports = { ...counters, fixture, migration, captured, sql };
