const fs = require('node:fs');
const path = require('node:path');
const base = require('./paged-readers-fixture.cjs');
const baseline = fs.readFileSync(path.join(__dirname, '../migrations/00000000000151_capture_functions.sql'), 'utf8');
const start = baseline.indexOf('CREATE OR REPLACE FUNCTION public.get_conversations_by_context(');
const end = baseline.indexOf('$function$', baseline.indexOf('AS $function$', start) + 'AS $function$'.length) + '$function$'.length;
if (start < 0 || end < start) throw Error('Missing captured context-inbox oracle');
const legacy = baseline.slice(start, end) + ';';
const { id, VIEWER, OWNER, FOREIGN } = base;
const extension = `
alter table conversations add column last_message_sender_id uuid;
create table marketplace_listings(id uuid primary key,title text,currency text,price numeric,images text[],visible boolean default true);
create table jobs(id uuid primary key,title text,company text,visible boolean default true);
alter table marketplace_listings enable row level security;alter table jobs enable row level security;
create policy listing_read on marketplace_listings for select to authenticated using(visible);
create policy job_read on jobs for select to authenticated using(visible);
grant select on marketplace_listings,jobs to authenticated;
drop policy conversations_read on conversations;
create policy conversations_read on conversations for select to authenticated using(
 user_1=auth.uid() or user_2=auth.uid() or exists(select 1 from conversation_members cm where cm.conversation_id=conversations.id and cm.user_id=auth.uid()));
insert into marketplace_listings values('${id(8800)}','A useful listing','GBP',12.50,array['first.jpg','second.jpg'],true);
insert into jobs values('${id(8801)}','Engineer','The company',true);
update conversations set context_ref_id=case when context='market' then '${id(8800)}'::uuid when context='jobs' then '${id(8801)}'::uuid end,
 last_message_sender_id=case when right(id::text,1)::integer%2=0 then '${VIEWER}'::uuid else '${OWNER}'::uuid end;
-- A membership-only DM must remain readable, just as in the original RPC.
update conversations set context='market',context_ref_id='${id(8800)}' where id='${id(3202)}';
insert into conversation_members values('${id(3202)}','${VIEWER}','epoch');
-- Archived/deleted settings were never a filter on this separate screen.
update conversation_settings set is_archived=true,is_deleted=true where conversation_id='${id(3003)}';
-- Pending without is_request stays visible; accepted with is_request does not.
update conversations set is_request=false,request_status='pending',request_sender_id='${OWNER}' where id='${id(3006)}';
update conversations set is_request=true,request_status='accepted' where id='${id(3009)}';
insert into messages(id,conversation_id,sender_id,receiver_id,created_at,deleted_at)
 values('${id(9800)}','${id(3003)}','${OWNER}','${VIEWER}','2026-02-01','2026-02-02');
`;
module.exports = { ...base, fixture: base.fixture + extension + base.legacy + base.migration + legacy,
  contextLegacy: legacy, contextMigration: fs.readFileSync(path.join(__dirname, '../migrations/20261102074640_bounded_context_inbox_reader.sql'), 'utf8') };
