-- Give a continuation its own indexable predicate even with a generic plan.
-- The first batch has no cursor. Subsequent batches start strictly after the
-- last timestamp and post ID, including when several posts share a timestamp.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $migration$
declare
 selector regprocedure := 'prepared_feed.select_page(text,double precision,uuid,integer)'::regprocedure;
 original text;
 batch constant text := $batch$     select array_agg(c.post_id order by c.created_at desc,c.post_id desc),array_agg(c.created_at order by c.created_at desc,c.post_id desc)
     into batch_ids,batch_times from(
       select c.post_id,c.created_at from feed_ranking.catalog c where c.bucket=days[chosen]
         and c.created_at>minimum_time and (p_mode<>'innovation' or c.channel='innovation')
         and (time_cursors[chosen] is null or (c.created_at,c.post_id)<(time_cursors[chosen],time_ids[chosen]))
       order by c.created_at desc,c.post_id desc limit 64
     )c;$batch$;
 predicate constant text := $predicate$         and (time_cursors[chosen] is null or (c.created_at,c.post_id)<(time_cursors[chosen],time_ids[chosen]))$predicate$;
 continuation constant text := '         and (c.created_at,c.post_id)<(time_cursors[chosen],time_ids[chosen])';
 replacement text;
 body text;
begin
 select prosrc into strict original from pg_proc where oid=selector and not prosecdef and provolatile='s'
   and proconfig=array['search_path=""']::text[];
 if md5(original) not in ('04e8e5e6a7c965331b92c7504bffe704','e6d5d8c4ee4795106ee201cb10287a17')
   or (length(original)-length(replace(original,batch,'')))/length(batch) <> 1 then
   raise exception 'PREPARED_FEED_TIME_SEEK_BASELINE_REQUIRED';
 end if;
 replacement := '     if time_cursors[chosen] is null then'||chr(10)||replace(batch,predicate,'')||
   chr(10)||'     else'||chr(10)||replace(batch,predicate,continuation)||chr(10)||'     end if;';
 body := replace(original,batch,replacement);
 -- A 200-winner refresh often walks thousands of IDs. Amortize the ordered
 -- index lookups and deduplication, then return to 64 near the existing proof
 -- boundary. The last iteration can still add at most 128 candidates.
 body := replace(body,' score_at integer:=200;',' fetch_size integer; score_at integer:=200;');
 body := replace(body,'   if mass_cursors[chosen] is null then',
   '   fetch_size:=least(256,greatest(64,(maximum_candidates-coalesce(cardinality(candidates),0))/2));'||chr(10)||
   '   if mass_cursors[chosen] is null then');
 body := replace(replace(body,' limit 64',' limit fetch_size'),'n<64','n<fetch_size');
 execute replace(pg_get_functiondef(selector),original,body);
end $migration$;

-- On a large catalog a generic plan can intersect a whole timestamp range
-- with a whole day via two bitmap scans, recheck thousands of rows under RLS
-- and then sort them to get 64. The ordered index already contains the full
-- continuation key. Scope this preference to the bounded ranking function.
alter function prepared_feed.select_page(text,double precision,uuid,integer)
 set enable_bitmapscan=off;

commit;
