-- Preserve the deployed feed projection/ranking and add the missing feedback
-- predicate. Failing on an unknown definition is safer than silently replacing it.
do $$
declare original text; patched text;
begin
  original := pg_get_functiondef('public.get_feed(text,double precision,uuid,integer)'::regprocedure);
  if position('from public.muted_authors' in original) = 0 and position('from muted_authors' in original) = 0 then
    patched := replace(original,
      'and not exists (select 1 from hidden_posts h',
      'and not exists (select 1 from public.muted_authors ma where ma.user_id = (select uid from viewer) and ma.author_id = p.user_id) and not exists (select 1 from hidden_posts h');
    if patched = original then raise exception 'get_feed feedback anchor not found; review deployed definition'; end if;
    execute patched;
  end if;
end;
$$;
