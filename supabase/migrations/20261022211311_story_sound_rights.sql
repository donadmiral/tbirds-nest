-- An Apple Music catalog entitlement is not a soundtrack/reuse license.
-- Existing sounds need review; this migration grants no rights retroactively.
alter table public.story_sounds
  add column if not exists rights_status text not null default 'unverified'
    check (rights_status in ('unverified', 'creator_attested', 'licensed', 'blocked')),
  add column if not exists rights_attested_at timestamptz,
  add column if not exists origin_story_id uuid references public.stories(id) on delete set null;
create unique index if not exists story_sounds_origin_story_unique on public.story_sounds(origin_story_id) where origin_story_id is not null;
create index if not exists story_sounds_available_popularity on public.story_sounds(source, use_count desc, id)
  where rights_status in ('creator_attested', 'licensed');

drop policy if exists story_sounds_select on public.story_sounds;
create policy story_sounds_select on public.story_sounds for select to authenticated
  using (rights_status in ('creator_attested', 'licensed') or owner_id = (select auth.uid()));
-- Only this RPC may create creator-attested sounds, from a published owned voiceover.
drop policy if exists story_sounds_insert on public.story_sounds;
revoke insert, update on public.story_sounds from anon, authenticated;

create or replace function public.publish_story_sound(p_story_id uuid, p_rights_attested boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_story public.stories; v_sound_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in to share an original sound' using errcode = '42501';
  end if;
  if p_rights_attested is distinct from true then
    raise exception 'Confirm that you own and can license this original sound' using errcode = '22023';
  end if;
  select * into v_story from public.stories where id = p_story_id;
  if not found or not public.can_act_as(v_story.user_id) then
    raise exception 'You cannot share sound from this story' using errcode = '42501';
  end if;
  if v_story.audio_source is distinct from 'voiceover' or v_story.audio_url is null
     or v_story.audio_duration_sec is null or v_story.audio_duration_sec not between 1 and 30 then
    raise exception 'Record an original voiceover of 1 to 30 seconds first' using errcode = '22023';
  end if;
  insert into public.story_sounds(owner_id, title, url, duration_sec, source, rights_status, rights_attested_at, origin_story_id)
    values (auth.uid(), coalesce(nullif(left(v_story.audio_title, 200), ''), 'Original sound'), v_story.audio_url,
      v_story.audio_duration_sec, 'original', 'creator_attested', now(), p_story_id)
    on conflict (origin_story_id) where origin_story_id is not null do nothing returning id into v_sound_id;
  if v_sound_id is null then select id into v_sound_id from public.story_sounds where origin_story_id = p_story_id; end if;
  return v_sound_id;
end $$;
revoke all on function public.publish_story_sound(uuid, boolean) from public, anon;
grant execute on function public.publish_story_sound(uuid, boolean) to authenticated;

comment on function public.publish_story_sound(uuid, boolean) is 'Records creator ownership/reuse attestation once per published story. Does not certify third-party rights.';
