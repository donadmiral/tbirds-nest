-- Complete canonical admission without enabling processing or paid compute.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Upload completion can follow content binding creation. Both orders must
-- converge on the same immutable (source ID, version, profile) queue key.
create function media_renditions.source_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.bucket_id in ('post-media', 'story-media')
     and new.name ~* '\.(mp4|mov|m4v)$'
     and exists(select 1 from media_renditions.settings where singleton and admission_enabled) then
    perform media_renditions.enqueue(new.id, new.version);
  end if;
  return new;
end $$;
revoke all on function media_renditions.source_added() from public, anon, authenticated, service_role;
create trigger enqueue_adaptive_uploaded_source after insert on storage.objects
for each row execute function media_renditions.source_added();

drop trigger enqueue_adaptive_media on public.content_media_bindings;
create trigger enqueue_adaptive_media
after insert or update of entity_kind, entity_id, bucket_id, object_path, uploader_id
on public.content_media_bindings for each row execute function media_renditions.binding_added();


commit;
