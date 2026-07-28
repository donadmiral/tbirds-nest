-- 0054: typing indicators must actually broadcast.
-- Adds conversation_typing to the realtime publication if missing.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'conversation_typing'
  ) then
    alter publication supabase_realtime add table public.conversation_typing;
  end if;
end $$;