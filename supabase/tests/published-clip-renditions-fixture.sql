-- The rendition DB suite isolates publication/provenance decisions here. The
-- full deployed clip ACL and ticket chain is tested in test-live-clip-delivery.
create schema live_streams;
create table live_streams.sessions(id uuid primary key,host_id uuid,audience text,can_create boolean not null default true);
create table live_streams.clip_runtime(singleton boolean primary key,project_origin text);
create table live_streams.worker_settings(singleton boolean primary key,project_origin text);
insert into live_streams.clip_runtime values(true,'https://abcdefghijklmnopqrst.supabase.co');
create table live_streams.clips(id uuid primary key,session_id uuid,owner_id uuid,creator_id uuid,current_lease uuid,output_prefix text,
 state text,moderation_state text,copyright_state text,render_revision integer,formats jsonb,manifest jsonb);
create table live_streams.clip_jobs(id uuid primary key,clip_id uuid,revision integer,state text,lease_id uuid);
create table live_streams.clip_publications(id uuid primary key,clip_id uuid,actor_id uuid,destination text,published_id uuid,target_id uuid,format text,state text);
create table public.channel_messages(id uuid primary key,channel_id uuid,sender_id uuid,media_url text);
create function live_streams.clip_can_create(p_session uuid,p_actor uuid) returns boolean language sql stable as $$
 select coalesce((select can_create from live_streams.sessions where id=p_session),false)
$$;
insert into storage.buckets(id,name,public) values('live-clips','live-clips',false);
