#!/usr/bin/env python3
"""Prepare, but do not publish, exactly two synthetic QA identities and two clips."""
import argparse, datetime, hashlib, json, os, pathlib, secrets, subprocess, uuid, warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)
import crypt
QA='uaulhuelcfkjwojtymmw'
def literal(value): return "'"+str(value).replace("'","''")+"'"
def write(path,text,mode=0o600):
 path.write_text(text);path.chmod(mode)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--directory');args=parser.parse_args()
 run=str(uuid.uuid4());root=pathlib.Path(args.directory or ('/tmp/pc-private-hls-'+run));root.mkdir(mode=0o700,parents=False,exist_ok=False)
 if not hasattr(crypt,'METHOD_BLOWFISH'): raise RuntimeError('Local bcrypt is required')
 state={'runId':run,'projectId':QA,'base':'https://'+QA+'.supabase.co','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'conversationId':str(uuid.uuid4()),'accounts':{},'media':{}}
 for role in ('sender','receiver'):
  uid=str(uuid.uuid4());password=secrets.token_urlsafe(36)
  state['accounts'][role]={'id':uid,'email':'qa-hls-'+run+'-'+role+'@example.invalid','password':password,'bcrypt':crypt.crypt(password,crypt.mksalt(crypt.METHOD_BLOWFISH)),'username':'qahls'+run.replace('-','')[:10]+role[0]}
 for kind in ('ordinary','limited'):
  state['media'][kind]={'id':str(uuid.uuid4()),'requestId':str(uuid.uuid4()),'path':state['accounts']['sender']['id']+'/'+run+'/'+kind+'.mp4'}
 write(root/'state.json',json.dumps(state,indent=2)+'\n')
 sender=state['accounts']['sender'];receiver=state['accounts']['receiver'];uid_values=','.join(literal(x['id']) for x in state['accounts'].values());cid=literal(state['conversationId'])
 sql=["begin;set local lock_timeout='3s';set local statement_timeout='20s';",
      "do $$begin if to_regprocedure('public.open_chat_hls_v1(uuid,uuid)') is null then raise exception 'Private HLS migration required';end if;end$$;"]
 for role,a in state['accounts'].items():
  uid=literal(a['id']);email=literal(a['email']);meta=literal(json.dumps({'qa_private_hls_canary':run,'full_name':'QA HLS '+role}))
  sql.append("insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token) values('00000000-0000-0000-0000-000000000000',"+uid+",'authenticated','authenticated',"+email+","+literal(a['bcrypt'])+",now(),'{\"provider\":\"email\",\"providers\":[\"email\"]}',"+meta+",now(),now(),'','','','','','');")
  identity=literal(json.dumps({'sub':a['id'],'email':a['email'],'email_verified':True,'phone_verified':False}))
  sql.append("insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) values("+uid+","+uid+","+identity+",'email',now(),now());")
  sql.append("insert into public.profiles(id,email,full_name,account_type) values("+uid+","+email+","+literal('QA HLS '+role)+",'personal') on conflict(id) do nothing;")
  sql.append("update public.profiles set username="+literal(a['username'])+" where id="+uid+" and email="+email+";")
 sql.append("insert into public.conversations(id,user_1,user_2,created_by,is_group,is_request,request_status,context) values("+cid+",least("+literal(sender['id'])+"::uuid,"+literal(receiver['id'])+"::uuid),greatest("+literal(sender['id'])+"::uuid,"+literal(receiver['id'])+"::uuid),"+literal(sender['id'])+",false,false,'none','personal');")
 sql.append("commit;select jsonb_build_object('fixtureUsers',(select count(*) from auth.users where id in("+uid_values+") and raw_user_meta_data->>'qa_private_hls_canary'="+literal(run)+"),'profiles',(select count(*) from profiles where id in("+uid_values+")),'conversation',(select count(*) from conversations where id="+cid+"));")
 write(root/'setup.sql','\n'.join(sql)+'\n')
 mid_values=','.join(literal(x['id']) for x in state['media'].values());paths=','.join(literal(x['path']) for x in state['media'].values())
 guard="do $$begin if (select count(*) from auth.users where id in("+uid_values+") and raw_user_meta_data->>'qa_private_hls_canary'="+literal(run)+")<>2 then raise exception 'Canary identity guard failed';end if;end$$;"
 cleanup="begin;set local lock_timeout='3s';set local statement_timeout='20s';\n"+guard+"\ndelete from public.notifications where recipient_id in("+uid_values+") and actor_id in("+uid_values+") and data->>'conversation_id'="+cid+";\ndelete from public.messages where id in("+mid_values+") and conversation_id="+cid+" and sender_id="+literal(sender['id'])+";\ndelete from public.conversations where id="+cid+" and user_1 in("+uid_values+") and user_2 in("+uid_values+");commit;\n"
 write(root/'cleanup-messages.sql',cleanup)
 status="select jsonb_build_object('sources',(select count(*) from storage.objects where bucket_id='chat-media' and name in("+paths+")),'derivatives',(select count(*) from storage.objects where bucket_id='adaptive-media' and name like "+literal(sender['id']+'/_renditions_v2/%')+"),'pendingAttempts',(select count(*) from media_renditions.attempts a join media_renditions.jobs j on j.id=a.job_id where j.source_owner="+literal(sender['id'])+" and not a.cleanup_done),'jobs',(select jsonb_agg(jsonb_build_object('id',id,'state',state,'path',source_path)) from media_renditions.jobs where source_owner="+literal(sender['id'])+"));\n"
 write(root/'status.sql',status)
 clean_guard="do $$begin if exists(select 1 from storage.objects where coalesce(owner_id,owner::text) in("+uid_values+") or name like "+literal(sender['id']+'/%')+" or name like "+literal(receiver['id']+'/%')+") or exists(select 1 from media_renditions.jobs j where j.source_owner in("+uid_values+") and (j.state in('pending','processing','retry','ready') or exists(select 1 from media_renditions.attempts a where a.job_id=j.id and not a.cleanup_done))) then raise exception 'Canary media or pending derivative cleanup remains';end if;end$$;"
 cleanup_users="begin;set local lock_timeout='3s';set local statement_timeout='20s';\n"+guard+'\n'+clean_guard+"\ndelete from auth.sessions where user_id in("+uid_values+");\ndelete from public.profiles where id in("+uid_values+");\ndelete from auth.identities where user_id in("+uid_values+");\ndelete from auth.users where id in("+uid_values+") and raw_user_meta_data->>'qa_private_hls_canary'="+literal(run)+";commit;\nselect count(*) as remaining_users from auth.users where id in("+uid_values+");\n"
 write(root/'cleanup-users.sql',cleanup_users)
 clip=root/'source.mp4'
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','4','-an','-c:v','libx264','-preset','veryfast','-crf','32','-pix_fmt','yuv420p','-movflags','+faststart',str(clip)],check=True)
 clip.chmod(0o600)
 manifest={k:state[k] for k in ('runId','projectId','createdAt','conversationId','media')};manifest['accounts']={k:{'id':v['id']} for k,v in state['accounts'].items()};manifest['clip']={'bytes':clip.stat().st_size,'sha256':hashlib.sha256(clip.read_bytes()).hexdigest(),'durationSeconds':4,'width':320,'height':180}
 write(root/'manifest.json',json.dumps(manifest,indent=2)+'\n')
 print(json.dumps({'prepared':True,'directory':str(root),'users':2,'sourceObjects':2,'maxEncodes':2,'clipBytes':clip.stat().st_size,'hostedMutations':0}))
if __name__=='__main__':main()
