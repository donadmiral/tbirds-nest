const fs = require('node:fs');
const path = require('node:path');
const base = require('./context-inbox-fixture.cjs');
const { id, OWNER: BUSINESS, VIEWER, FOREIGN } = base;
const source = name => fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8');
const baseline = source('00000000000151_capture_functions.sql');
const start = baseline.indexOf('CREATE OR REPLACE FUNCTION public.get_business_conversations(');
const end = baseline.indexOf('$function$', baseline.indexOf('AS $function$', start) + 'AS $function$'.length) + '$function$'.length;
if (start < 0 || end < start) throw Error('Missing business inbox legacy oracle');
const businessLegacy = baseline.slice(start, end) + ';';
const org = source('00000000000152_organizations.sql');
const organizationFunctions = ['org_role_for_profile', 'org_delegated_scopes', 'is_business_member'].map(name => {
  const at = org.indexOf('create or replace function public.' + name + '(');
  const until = org.indexOf('$$;', org.indexOf('as $$', at) + 5) + 3;
  if (at < 0 || until < at) throw Error('Missing canonical organization helper ' + name);
  return org.slice(at, until);
}).join('\n');
const extension = `
alter table conversations add column type text not null default 'direct';
update conversations set type='group' where is_group;
alter table messages add column text text;
update messages set text='Original message';
create index idx_messages_conv_sender on messages(conversation_id,sender_id);
create table business_members(business_id uuid,member_id uuid,primary key(business_id,member_id));
create table organizations(id uuid primary key,profile_id uuid,parent_id uuid);
create table org_memberships(org_id uuid,user_id uuid,role text,expires_at timestamptz,primary key(org_id,user_id));
create table org_delegations(client_org_id uuid,principal_org_id uuid,scopes text[],expires_at timestamptz);
${organizationFunctions}
insert into organizations values('${id(9900)}','${BUSINESS}',null),('${id(9901)}',null,null),('${id(9902)}','${FOREIGN}',null);
insert into business_members values('${BUSINESS}','${VIEWER}');
-- Requests mean no message authored by the business, regardless of the
-- conversation's is_request flag, settings or a message's deleted marker.
delete from messages where sender_id='${BUSINESS}' and right(conversation_id::text,4)::integer%2=1;
insert into messages(id,conversation_id,sender_id,receiver_id,created_at,read_at,deleted_at,hidden,text)
 select ('30000000-0000-0000-0000-'||lpad(right(c.id::text,4),12,'0'))::uuid,c.id,
 case when c.user_1='${BUSINESS}' then c.user_2 else c.user_1 end,'${BUSINESS}',
 '2026-04-01'::timestamptz+right(c.id::text,4)::integer*interval '1 microsecond',
 case when right(c.id::text,1)::integer%5=0 then now() end,
 case when right(c.id::text,1)::integer%7=0 then now() end,
 right(c.id::text,1)::integer%3=0,'Canonical latest message'
 from conversations c where c.type='direct' and (c.user_1='${BUSINESS}' or c.user_2='${BUSINESS}');
-- Empty direct conversations retain NULLS LAST order and count as requests.
insert into conversations(id,user_1,user_2,context,is_request) values
 ('${id(4100)}','${BUSINESS}','${VIEWER}','jobs',false),('${id(4101)}','${BUSINESS}','${VIEWER}','market',false);
-- The conversation preview is deliberately stale: the original business
-- reader derives its preview/sender/activity from the messages table.
update conversations set last_message='Stale conversation preview',last_message_time='2030-01-01';
${businessLegacy}
`;
module.exports = { ...base, BUSINESS, fixture: base.fixture + base.contextMigration + extension,
  businessLegacy, businessMigration: source('20261102075537_bounded_business_inbox_reader.sql') };
