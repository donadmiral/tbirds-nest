-- 0107 Vouching from the app. Applications are private to their owner,
-- so a verified member vouches BY USER: this definer function finds the
-- person's open application and records the referral. The column naming
-- of verification_applications is detected, not assumed.

do $do$
declare
  v_col text;
begin
  select column_name into v_col from information_schema.columns
   where table_schema = 'public' and table_name = 'verification_applications'
     and column_name in ('user_id', 'applicant_id', 'profile_id')
   order by case column_name when 'user_id' then 1 when 'applicant_id' then 2 else 3 end
   limit 1;
  if v_col is null then
    raise exception 'verification_applications has no recognised owner column';
  end if;
  execute format($f$
    create or replace function public.vouch_for(p_user_id uuid, p_note text default null)
    returns jsonb
    language plpgsql security definer set search_path = public
    as $fn$
    declare
      v_me uuid := auth.uid();
      v_app uuid;
    begin
      if v_me is null then raise exception 'Not signed in'; end if;
      if v_me = p_user_id then return jsonb_build_object('error', 'own'); end if;
      if not exists (select 1 from profiles where id = v_me and is_verified = true) then
        return jsonb_build_object('error', 'not_verified');
      end if;
      select id into v_app from verification_applications
       where %I = p_user_id and status in ('pending', 'submitted')
       order by created_at desc limit 1;
      if v_app is null then return jsonb_build_object('error', 'no_application'); end if;
      insert into verification_referrals (application_id, referrer_id, note)
      values (v_app, v_me, nullif(trim(coalesce(p_note, '')), ''))
      on conflict (application_id, referrer_id) do nothing;
      return jsonb_build_object('ok', true);
    end;
    $fn$;
  $f$, v_col);
  execute 'grant execute on function public.vouch_for(uuid, text) to authenticated';
end
$do$;