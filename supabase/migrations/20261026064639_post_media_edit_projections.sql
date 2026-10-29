-- Preserve recipes without replacing deployed ranking or visibility predicates.
create or replace function public.feed_media_json(p_post_id uuid)
returns jsonb language sql stable set search_path = public as $function$
 select coalesce((select jsonb_agg(jsonb_build_object(
 'id',m.id,'url',m.url,'media_type',m.media_type,'width',m.width,'height',m.height,
 'sort_order',m.sort_order,'is_sensitive',m.is_sensitive,'alt_text',m.alt_text,'edit',m.edit
 ) order by m.sort_order nulls last,m.id) from public.post_media m where m.post_id=p_post_id),'[]'::jsonb);
$function$;
revoke all on function public.feed_media_json(uuid) from public,anon;
grant execute on function public.feed_media_json(uuid) to authenticated;
do $migration$
declare signature text; original text; media_alias text; anchor text; addition text;
begin
 foreach signature in array array[
 'public.get_feed(text,double precision,uuid,integer)',
 'public.get_discover_page(text,boolean,integer,integer,timestamp with time zone)',
 'public.get_profile_posts(uuid,timestamp with time zone,integer)',
 'public.get_profile_posts_page(uuid,integer,integer,timestamp with time zone)',
 'public.get_community_posts(uuid,timestamp with time zone,integer)',
 'public.get_community_posts_page(uuid,integer,integer,timestamp with time zone)',
 'public.search_posts(text,text,timestamp with time zone,uuid,integer)',
 'public.search_posts_page(text,text,integer,integer,timestamp with time zone)'
 ] loop
  if to_regprocedure(signature) is null then raise exception 'Missing post media read RPC %; review migration order',signature; end if;
  original:=pg_get_functiondef(to_regprocedure(signature));
  if position('feed_media_json(' in original)>0 then continue; end if;
  media_alias:=case when signature like 'public.search_posts%' then 'pm' else 'm' end;
  anchor:=format('''media_type'', %s.media_type',media_alias);
  if position(anchor in original)=0 then raise exception 'Unknown post media projection in %; review deployed definition',signature; end if;
  addition:='';
  if position(format('''edit'', %s.edit',media_alias) in original)=0 then addition:=addition||format(', ''edit'', %s.edit',media_alias); end if;
  if position(format('''alt_text'', %s.alt_text',media_alias) in original)=0 then addition:=addition||format(', ''alt_text'', %s.alt_text',media_alias); end if;
  if position(format('''is_sensitive'', %s.is_sensitive',media_alias) in original)=0 then addition:=addition||format(', ''is_sensitive'', %s.is_sensitive',media_alias); end if;
  if media_alias='pm' and position('''id'', pm.id' in original)=0 then addition:=addition||', ''id'', pm.id, ''sort_order'', pm.sort_order'; end if;
  if addition<>'' then execute replace(original,anchor,anchor||addition); end if;
 end loop;
end;
$migration$;
