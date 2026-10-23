-- Owner-only preview of uploaded assets before a story, article, or scheduled
-- post exists. Client-supplied URLs alone never authorize an object.
create or replace function public.content_upload_manifest(p_urls jsonb)
returns table(media_url text)
language plpgsql stable security definer set search_path = '' as $$
declare v_url text; v_location text[];
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if jsonb_typeof(p_urls) is distinct from 'array' or jsonb_array_length(p_urls)>100 then
    raise exception 'At most 100 upload references are allowed' using errcode='22023';
  end if;
  for v_url in select distinct value from jsonb_array_elements_text(p_urls) loop
    v_location := regexp_match(v_url, '^https://[^/]+/storage/v1/(?:object/(?:public|sign|authenticated)|render/image/(?:public|sign|authenticated))/(post-media|story-media|media)/([^?#]+)');
    if v_location is null or v_location[2] ~ '(%|\\|(^|/)\.\.?(/|$)|//)' then continue; end if;
    if exists(select 1 from storage.objects o where o.bucket_id=v_location[1] and o.name=v_location[2]
      and coalesce(o.owner_id,o.owner::text)=auth.uid()::text) then
      media_url := v_url; return next;
    end if;
  end loop;
end $$;
revoke all on function public.content_upload_manifest(jsonb) from public,anon;
grant execute on function public.content_upload_manifest(jsonb) to authenticated;
