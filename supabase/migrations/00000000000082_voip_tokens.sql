-- 0082 VoIP push token storage (CallKit prep). The iOS PushKit token lives
-- beside the Expo token on the same device row; the APNs sender reads it.

alter table public.user_push_tokens add column if not exists voip_token text;

create or replace function public.save_voip_token(p_expo_token text, p_voip_token text)
returns void language sql security definer set search_path = public
as $fn$
  update user_push_tokens
  set voip_token = p_voip_token
  where user_id = auth.uid() and expo_push_token = p_expo_token;
$fn$;

grant execute on function public.save_voip_token(text, text) to authenticated;