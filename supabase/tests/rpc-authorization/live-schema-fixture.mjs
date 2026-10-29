import {readFile} from 'node:fs/promises';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {uuid_ossp} from '@electric-sql/pglite/contrib/uuid_ossp';
export const extensions={pg_trgm,pgcrypto,uuid_ossp};
export async function loadLiveSchema(db){
 await db.exec(`create role anon;create role authenticated;create role service_role;create publication supabase_realtime;
 create schema auth;create schema storage;create schema extensions;create schema vault;create schema net;create table vault.secrets(id uuid primary key default gen_random_uuid(),name text,secret text,description text);
 create view vault.decrypted_secrets as select id,name,secret as decrypted_secret,description from vault.secrets;
 create function vault.create_secret(p_secret text,p_name text,p_description text) returns uuid language sql as $$insert into vault.secrets(name,secret,description) values(p_name,p_secret,p_description) returning id$$;create table net.http_request_queue(id bigint);
 create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb,deleted_at timestamptz,banned_until timestamptz,updated_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid,aal text,not_after timestamptz);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb);
 alter table storage.objects enable row level security;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;
 set search_path=public,extensions;set check_function_bodies=off;`);

 let source=await readFile(new URL('../../reference/live-schema-20261017.sql',import.meta.url),'utf8');
 // The hosted restore guard intentionally requires empty real managed schemas.
 // This test has a synthetic managed-schema fixture and never connects to a host.
 source=source.replace(/DO \$qa_guard\$[\s\S]*?\$qa_guard\$;/,'');
 await db.exec(source);
 await db.exec("set check_function_bodies=on;");
}
