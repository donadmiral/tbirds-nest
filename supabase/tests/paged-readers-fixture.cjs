const fs = require('node:fs');
const path = require('node:path');
const migrations = path.join(__dirname, '../migrations');
const read = file => fs.readFileSync(path.join(migrations, file), 'utf8');
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const OWNER = id(1), VIEWER = id(2), FOREIGN = id(3), BOOK = id(10), PRIVATE_BOOK = id(11);
const fixture = `
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
grant usage on schema public to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on all functions in schema auth to anon,authenticated,service_role;
create table profiles(id uuid primary key,full_name text,username text,avatar_url text,is_verified boolean default false,
 verified_tier text,deactivated_at timestamptz,account_type text default 'personal',profile_visibility text default 'public',hidden boolean default false);
create table blocked_users(blocker_id uuid,blocked_id uuid);
create table follows(follower_id uuid,following_id uuid);
create table stories(id uuid primary key,user_id uuid references profiles(id) on delete cascade,
 media_url text,media_type text,thumbnail_url text,caption text,text_background text,stickers_json jsonb,
 media_transform jsonb,filter_id text,duration_sec numeric,dual_front_url text,
 audio_sound_id uuid,audio_duration_sec numeric,audio_title text,audio_url text,views_count integer default 0);
create table memory_albums(id uuid primary key,user_id uuid references profiles(id) on delete cascade,
 is_default boolean not null default false,title text,subtitle text,cover_color text,cover_design text,cover_story_id uuid,
 audience text default 'profile',soundtrack jsonb,presentation_revision integer default 0,cover_artwork jsonb default '{}',
 film_settings jsonb default '{}',created_at timestamptz not null default now());
create table memory_album_access(album_id uuid,user_id uuid,kind text);
create table memory_pages(id uuid primary key,album_id uuid references memory_albums(id) on delete cascade,
 user_id uuid references profiles(id) on delete cascade,story_id uuid references stories(id) on delete set null,
 sort_order integer not null default 0,created_at timestamptz not null default now(),style text not null default 'polaroid',
 media_url text,media_type text not null default 'image',thumbnail_url text,caption text,taken_at timestamptz);
create unique index memory_pages_album_story_key on memory_pages(album_id,story_id);
create index memory_pages_album_idx on memory_pages(album_id,sort_order);
create table allowed_sounds(id uuid primary key);
create function public.sound_rights_allow(p_sound uuid,p_use text) returns boolean language sql stable set search_path='' as $$
 select p_use='memory_album' and exists(select 1 from public.allowed_sounds where id=p_sound);
$$;
create function public.can_view_memory_book(p_album uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare a public.memory_albums%rowtype;u uuid:=auth.uid();
begin
 select * into a from public.memory_albums where id=p_album;
 if u is null or a.id is null or not exists(select 1 from public.profiles where id=a.user_id and deactivated_at is null)
  or not exists(select 1 from public.profiles where id=u and deactivated_at is null) then return false;end if;
 if a.user_id=u then return true;end if;
 if exists(select 1 from public.blocked_users where (blocker_id=u and blocked_id=a.user_id) or (blocked_id=u and blocker_id=a.user_id))
  or exists(select 1 from public.memory_album_access where album_id=a.id and user_id=u and kind='block') then return false;end if;
 if a.audience='only_me' then return false;end if;
 if a.audience='custom' then return exists(select 1 from public.memory_album_access where album_id=a.id and user_id=u and kind='allow');end if;
 if a.audience='followers' then return exists(select 1 from public.follows where follower_id=u and following_id=a.user_id);end if;
 return exists(select 1 from public.profiles where id=a.user_id and profile_visibility<>'private')
  or exists(select 1 from public.follows where follower_id=u and following_id=a.user_id);
end $$;
create function public.can_view_memory_album(p_owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memory_albums a where a.user_id=p_owner and public.can_view_memory_book(a.id));
$$;
create schema memory_creative;
create function memory_creative.actor(p_lock boolean) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'MEMORY_AUTHENTICATED_SESSION_REQUIRED' using errcode='42501';end if;
 if current_setting('test.session',true) is distinct from 'active' then raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and deactivated_at is null) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501';end if;
 if current_setting('test.business',true)='denied' then raise exception 'BUSINESS_SESSION_REQUIRED' using errcode='42501';end if;
 if current_setting('test.erasure',true)='pending' then raise exception 'ACCOUNT_ERASURE_PENDING' using errcode='42501';end if;
 return auth.uid();
end $$;
create table conversations(id uuid primary key,user_1 uuid not null,user_2 uuid,last_message text,last_message_time timestamptz,
 is_group boolean not null default false,group_name text,group_emoji text,group_avatar_url text,group_type text,group_ref_id uuid,
 context text not null default 'personal',context_ref_id uuid,is_request boolean not null default false,
 request_status text not null default 'accepted',request_sender_id uuid);
create index idx_conversations_user_1 on conversations(user_1);
create index idx_conversations_user_2 on conversations(user_2);
create table conversation_members(conversation_id uuid references conversations(id) on delete cascade,user_id uuid references profiles(id) on delete cascade,
 last_read_at timestamptz not null default 'epoch',primary key(conversation_id,user_id));
create index idx_conversation_members_user on conversation_members(user_id,conversation_id);
create table conversation_settings(conversation_id uuid references conversations(id) on delete cascade,user_id uuid,
 is_pinned boolean not null default false,is_muted boolean not null default false,is_archived boolean not null default false,
 is_deleted boolean not null default false,manually_unread boolean not null default false,primary key(conversation_id,user_id));
create index idx_conv_settings_user_conv on conversation_settings(user_id,conversation_id);
create table messages(id uuid primary key,conversation_id uuid references conversations(id) on delete cascade,
 sender_id uuid,receiver_id uuid,created_at timestamptz not null,read_at timestamptz,deleted_at timestamptz,hidden boolean default false);
create index idx_messages_conv_created_desc on messages(conversation_id,created_at desc);
create index idx_messages_receiver_unread on messages(receiver_id,read_at) where read_at is null;
alter table profiles enable row level security;
alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table conversation_settings enable row level security;
alter table messages enable row level security;
create policy profiles_read on profiles for select to authenticated using(not hidden or id=auth.uid());
create policy memberships_read on conversation_members for select to authenticated using(user_id=auth.uid());
create policy settings_read on conversation_settings for select to authenticated using(user_id=auth.uid());
create policy conversations_read on conversations for select to authenticated using(
 (not is_group and (user_1=auth.uid() or user_2=auth.uid())) or
 (is_group and exists(select 1 from conversation_members cm where cm.conversation_id=conversations.id and cm.user_id=auth.uid())));
create policy messages_read on messages for select to authenticated using(not hidden and
 (sender_id=auth.uid() or receiver_id=auth.uid() or exists(select 1 from conversation_members cm where cm.conversation_id=messages.conversation_id and cm.user_id=auth.uid())));
grant select on profiles,conversations,conversation_members,conversation_settings,messages to authenticated;
insert into profiles(id,full_name,username,avatar_url,is_verified,verified_tier) values
 ('${OWNER}','Owner','owner','owner.jpg',true,'platinum'),('${VIEWER}','Viewer','viewer','viewer.jpg',false,null),('${FOREIGN}','Foreign','foreign','foreign.jpg',false,null);
insert into allowed_sounds values('${id(700)}');
insert into memory_albums(id,user_id,title,subtitle,cover_color,cover_design,cover_story_id,cover_artwork,film_settings,soundtrack) values
 ('${BOOK}','${OWNER}','My book','Preserved','sage','keepsake','${id(1078)}',
  '{"storyIds":["${id(1078)}","${id(1003)}"]}','{"transition":"fade"}','{"soundId":"${id(700)}"}'),
 ('${PRIVATE_BOOK}','${FOREIGN}','Private','Private','ink','classic',null,'{}','{}',null);
update memory_albums set audience='only_me' where id='${PRIVATE_BOOK}';
insert into stories(id,user_id,media_url,media_type,thumbnail_url,caption,text_background,stickers_json,media_transform,filter_id,
 duration_sec,dual_front_url,audio_sound_id,audio_duration_sec,audio_title,audio_url)
 select ('00000000-0000-0000-0000-'||lpad((1000+n)::text,12,'0'))::uuid,'${OWNER}','story-'||n,
 case when n%3=0 then 'text' when n%3=1 then 'image' else 'video' end,'thumb-'||n,'caption-'||n,'#fff','[{"type":"text"}]','{"x":2}','warm',12,'dual-'||n,
 case when n%2=0 then '${id(700)}'::uuid else '${id(701)}'::uuid end,8,'Track','audio-'||n from generate_series(1,83)n;
insert into memory_pages(id,album_id,user_id,story_id,sort_order,created_at,caption,media_url,thumbnail_url)
 select ('00000000-0000-0000-0000-'||lpad((2000+n)::text,12,'0'))::uuid,'${BOOK}','${OWNER}',
 ('00000000-0000-0000-0000-'||lpad((1000+n)::text,12,'0'))::uuid,n/5,'2026-01-01'::timestamptz+(n%2)*interval '1 microsecond','page-'||n,'fallback-'||n,'fallback-thumb-'||n from generate_series(1,83)n;
insert into stories(id,user_id,media_url,media_type) values('${id(1090)}','${FOREIGN}','foreign-secret','image');
insert into memory_pages(id,album_id,user_id,story_id,sort_order) values('${id(2090)}','${BOOK}','${OWNER}','${id(1090)}',0),('${id(2091)}','${BOOK}','${OWNER}',null,0);
insert into conversations(id,user_1,user_2,last_message,last_message_time,context,is_request,request_status,request_sender_id)
 select ('00000000-0000-0000-0000-'||lpad((3000+n)::text,12,'0'))::uuid,'${VIEWER}','${OWNER}','message-'||n,
 case when n%13=0 then null else '2026-01-01'::timestamptz+(n/3)*interval '1 second'+(n%3)*interval '1 microsecond' end,
 case when n%3=0 then 'market' when n%3=1 then 'jobs' else 'personal' end,n%17=0,
 case when n%17=0 then 'pending' else 'accepted' end,case when n%17=0 then '${OWNER}'::uuid end from generate_series(1,127)n;
insert into conversations(id,user_1,user_2,last_message,last_message_time,is_group,group_name,group_avatar_url,group_type,group_ref_id)
 values('${id(3200)}','${OWNER}',null,'group latest','2026-02-01',true,'Friends','private-group.jpg','community','${id(900)}'),
 ('${id(3201)}','${FOREIGN}',null,'must not leak','2026-03-01',true,'Foreign group',null,null,null),
 ('${id(3202)}','${FOREIGN}','${OWNER}','must not leak','2026-03-01',false,null,null,null,null);
insert into conversation_members values('${id(3200)}','${VIEWER}','2025-12-31'),('${id(3201)}','${FOREIGN}','epoch'),('${id(3002)}','${VIEWER}','2025-12-31');
insert into conversation_settings(conversation_id,user_id,is_pinned,is_muted,is_archived,is_deleted,manually_unread)
 select id,'${VIEWER}',right(id::text,3)::integer%7=0,right(id::text,3)::integer%11=0,
 right(id::text,3)::integer%5=0,right(id::text,3)::integer%19=0,right(id::text,3)::integer%23=0 from conversations where user_1='${VIEWER}';
insert into messages(id,conversation_id,sender_id,receiver_id,created_at,read_at,deleted_at,hidden)
 select ('00000000-0000-0000-0000-'||lpad((5000+n)::text,12,'0'))::uuid,
 ('00000000-0000-0000-0000-'||lpad((3000+(n%127)+1)::text,12,'0'))::uuid,'${OWNER}','${VIEWER}',
 '2026-01-01'::timestamptz+n*interval '1 second',case when n%5=0 then '2026-02-01'::timestamptz end,
 case when n%7=0 then '2026-02-02'::timestamptz end,n%11=0 from generate_series(1,850)n;
insert into messages(id,conversation_id,sender_id,receiver_id,created_at) values
 ('${id(5901)}','${id(3200)}','${OWNER}',null,'2026-01-01'),
 ('${id(5902)}','${id(3200)}','${OWNER}','${VIEWER}','2026-01-02'),
 ('${id(5903)}','${id(3200)}','${VIEWER}',null,'2026-01-03'),
 ('${id(5904)}','${id(3201)}','${FOREIGN}',null,'2026-01-01');
`;
// Use the existing public reader bodies as the compatibility oracle, rather
// than reproducing their result calculation inside assertions.
const visual = read('20261029055318_memory_book_reader_visual_projection.sql');
const visualBook = visual.slice(visual.indexOf('CREATE OR REPLACE FUNCTION public.get_memory_book('), visual.indexOf('CREATE OR REPLACE FUNCTION public.get_memory_albums('));
const visualShelf = visual.slice(visual.indexOf('CREATE OR REPLACE FUNCTION public.get_memory_albums('), visual.lastIndexOf('COMMIT;'));
const music = read('20261030153811_original_music_library_and_delivery.sql');
const musicBook = music.slice(music.indexOf('create function public.get_memory_book(p_album uuid)'), music.indexOf('create function public.authorize_original_audio_export'));
const creative = read('20261031012805_memory_book_creative_public_contracts.sql');
const creativeBook = creative.slice(creative.indexOf('create or replace function public.get_memory_book('), creative.indexOf('create or replace function public.get_memory_albums('));
const creativeShelf = creative.slice(creative.indexOf('create or replace function public.get_memory_albums('), creative.indexOf('create function public.get_memory_book_creative_capabilities('));
const covers = read('20261101181618_memory_cover_personalization_v2.sql');
const coverFunctions = covers.slice(covers.indexOf('create function memory_creative.cover_pages('), covers.indexOf('create or replace function memory_creative.save_book('));
const baseline = read('00000000000151_capture_functions.sql');
function baselineFunction(name) {
  const start = baseline.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '()');
  const bodyStart = baseline.indexOf('AS $function$', start) + 'AS $function$'.length;
  const end = baseline.indexOf('$function$', bodyStart) + '$function$'.length;
  if (start < 0 || end < start) throw new Error('Missing canonical function: ' + name);
  return baseline.slice(start, end) + ';';
}
const legacy = visualBook + '\nalter function public.get_memory_book(uuid) rename to get_memory_book_before_music;\n'
  + musicBook.replace('create function public.get_memory_book(', 'create function memory_creative.base_book(')
  + visualShelf.replace('CREATE OR REPLACE FUNCTION public.get_memory_albums(', 'CREATE FUNCTION memory_creative.base_shelf(')
  + coverFunctions + creativeBook + creativeShelf + baselineFunction('get_unread_counts') + baselineFunction('get_context_unread')
  + '\ngrant execute on function public.get_memory_book(uuid),public.get_unread_counts(),public.get_context_unread() to authenticated;\n'
  + 'revoke all on schema memory_creative from public,anon,authenticated,service_role;';
const migration = read('20261102064915_bounded_book_and_inbox_readers.sql');
const login = (user = VIEWER) => `reset role;select set_config('request.jwt.claim.sub','${user}',false),set_config('request.jwt.claim.role','authenticated',false),set_config('test.session','active',false),set_config('test.business','allowed',false),set_config('test.erasure','none',false);set role authenticated;`;
module.exports = { fixture, legacy, migration, login, id, OWNER, VIEWER, FOREIGN, BOOK, PRIVATE_BOOK };
