#!/usr/bin/env python3
"""Prepare exactly two marked QA identities and one image/video carousel. No network writes."""
import argparse
import datetime
import hashlib
import json
import pathlib
import secrets
import subprocess
import uuid
import warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)
import crypt
from PIL import Image, ImageDraw

QA = 'uaulhuelcfkjwojtymmw'
def literal(value):
    return "'" + str(value).replace("'", "''") + "'"
def write(path, value):
    path.write_text(value)
    path.chmod(0o600)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    root = pathlib.Path(parser.parse_args().directory)
    root.mkdir(mode=0o700, parents=False, exist_ok=False)
    run = str(uuid.uuid4())
    state = {'runId': run, 'projectId': QA, 'base': 'https://' + QA + '.supabase.co',
             'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
             'postId': str(uuid.uuid4()), 'caption': 'Connected cache QA ' + run[:8], 'accounts': {}, 'media': {}}
    for role in ('author', 'viewer'):
        password = secrets.token_urlsafe(36)
        state['accounts'][role] = {'id': str(uuid.uuid4()), 'email': 'qa-cache-' + run + '-' + role + '@example.invalid',
                                  'password': password, 'bcrypt': crypt.crypt(password, crypt.mksalt(crypt.METHOD_BLOWFISH)),
                                  'username': 'qacache' + run.replace('-', '')[:10] + role[0]}
    author, viewer = state['accounts']['author'], state['accounts']['viewer']
    image = Image.new('RGB', (320, 240), '#eef1f5')
    draw = ImageDraw.Draw(image)
    for box, color in [((0, 0, 159, 119), '#e43d30'), ((160, 0, 319, 119), '#20b15a'),
                       ((0, 120, 159, 239), '#2548d8'), ((160, 120, 319, 239), '#f5d620')]:
        draw.rectangle(box, fill=color)
    draw.ellipse((105, 65, 215, 175), fill='white', outline='#111111', width=5)
    image.save(root / 'source.png')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i',
                    'testsrc2=size=320x240:rate=24', '-t', '4', '-an', '-c:v', 'libx264', '-preset', 'veryfast',
                    '-crf', '32', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(root / 'source.mp4')], check=True)
    for kind, extension, mime in [('image', 'png', 'image/png'), ('video', 'mp4', 'video/mp4')]:
        file = root / ('source.' + extension)
        file.chmod(0o600)
        data = file.read_bytes()
        assert 0 < len(data) < 262144, 'Bounded canary media required'
        state['media'][kind] = {'id': str(uuid.uuid4()), 'path': author['id'] + '/' + run + '/source.' + extension,
                                'file': file.name, 'mime': mime, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                                'width': 320, 'height': 240}
    sql = ["begin;set local lock_timeout='3s';set local statement_timeout='20s';"]
    for role, account in state['accounts'].items():
        uid, email = literal(account['id']), literal(account['email'])
        meta = literal(json.dumps({'qa_physical_cache_canary': run, 'full_name': 'QA Cache ' + role}))
        identity = literal(json.dumps({'sub': account['id'], 'email': account['email'], 'email_verified': True, 'phone_verified': False}))
        sql.append("insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token) values('00000000-0000-0000-0000-000000000000'," + uid + ",'authenticated','authenticated'," + email + ',' + literal(account['bcrypt']) + ",now(),'{\"provider\":\"email\",\"providers\":[\"email\"]}'," + meta + ",now(),now(),'','','','','','');")
        sql.append("insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) values(" + uid + ',' + uid + ',' + identity + ",'email',now(),now());")
        sql.append("insert into public.profiles(id,email,full_name,account_type) values(" + uid + ',' + email + ',' + literal('QA Cache ' + role) + ",'personal') on conflict(id) do nothing;")
        sql.append("update public.profiles set username=" + literal(account['username']) + ",profile_visibility='public' where id=" + uid + ' and email=' + email + ';')
    sql.append('insert into public.follows(follower_id,following_id,account_type) values(' + literal(viewer['id']) + ',' + literal(author['id']) + ",'personal');")
    ids = ','.join(literal(a['id']) for a in state['accounts'].values())
    sql.append("commit;select count(*) as marked_fixture_users from auth.users where id in(" + ids + ") and raw_user_meta_data->>'qa_physical_cache_canary'=" + literal(run) + ';')
    write(root / 'setup.sql', '\n'.join(sql) + '\n')
    guard = "do $$begin if (select count(*) from auth.users where id in(" + ids + ") and raw_user_meta_data->>'qa_physical_cache_canary'=" + literal(run) + ")<>2 then raise exception 'Physical canary identity guard failed';end if;end$$;"
    prefix = "begin;set local lock_timeout='3s';set local statement_timeout='20s';\n" + guard + '\n'
    cleanup_post = prefix + 'delete from public.posts where id=' + literal(state['postId']) + ' and user_id=' + literal(author['id']) + ' and body=' + literal(state['caption']) + ';commit;\n'
    write(root / 'cleanup-post.sql', cleanup_post)
    pending = ["exists(select 1 from " + schema + ".jobs j where j.source_owner in(" + ids
               + ") and (j.state in('pending','processing','retry','ready') or exists(select 1 from " + schema
               + ".attempts a where a.job_id=j.id and not a.cleanup_done)))" for schema in ('media_renditions', 'media_processing')]
    storage_guard = "do $$begin if exists(select 1 from storage.objects where coalesce(owner_id,owner::text) in(" + ids + ') or name like ' + literal(author['id'] + '/%') + ') or ' + ' or '.join(pending) + " then raise exception 'Physical canary media cleanup remains';end if;end$$;\n"
    cleanup = prefix + storage_guard + 'delete from public.notifications where recipient_id in(' + ids + ') or actor_id in(' + ids + ');\n'
    cleanup += 'delete from public.follows where follower_id=' + literal(viewer['id']) + ' and following_id=' + literal(author['id']) + ';\n'
    cleanup += 'delete from auth.sessions where user_id in(' + ids + ');\ndelete from public.profiles where id in(' + ids + ');\ndelete from auth.identities where user_id in(' + ids + ');\n'
    cleanup += "delete from auth.users where id in(" + ids + ") and raw_user_meta_data->>'qa_physical_cache_canary'=" + literal(run) + ';commit;\n'
    cleanup += 'select count(*) as remaining_canary_users from auth.users where id in(' + ids + ');\n'
    write(root / 'cleanup-users.sql', cleanup)
    status = "select jsonb_build_object('users',(select count(*) from auth.users where id in(" + ids + ")),'posts',(select count(*) from public.posts where id=" + literal(state['postId']) + "),'sourceObjects',(select count(*) from storage.objects where bucket_id='post-media' and name like " + literal(author['id'] + '/' + run + '/%') + "),'derivedObjects',(select count(*) from storage.objects where bucket_id in('derived-media','adaptive-media') and name like " + literal(author['id'] + '/%') + "),'pendingCleanup',(select count(*) from media_renditions.attempts a join media_renditions.jobs j on j.id=a.job_id where j.source_owner=" + literal(author['id']) + " and not a.cleanup_done),'jobs',(select jsonb_agg(jsonb_build_object('state',state,'path',source_path)) from media_renditions.jobs where source_owner=" + literal(author['id']) + '));\n'
    write(root / 'status.sql', status)
    write(root / 'state.json', json.dumps(state, indent=2) + '\n')
    manifest = {key: state[key] for key in ('runId', 'projectId', 'createdAt', 'postId', 'caption', 'media')}
    manifest['accounts'] = {key: {'id': account['id']} for key, account in state['accounts'].items()}
    write(root / 'manifest.json', json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'prepared': True, 'directory': str(root), 'users': 2, 'posts': 1, 'media': 2, 'hostedMutations': 0}))

if __name__ == '__main__':
    main()
