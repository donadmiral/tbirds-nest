-- Read-only operator visibility. No approve, resume or retention bypass action.
begin;
create or replace function public.triniti_admin_deletion_requests(p_actor_id uuid,p_session_id uuid,p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform admin_ops.require_session(p_actor_id,p_session_id,'account_delete');
 if p_page is null or p_page not between 1 and 10000 then raise exception 'INVALID_PAGE';end if;
 with requests as (
  select d.id,d.id request_id,'admin'::text source,d.user_id,d.reason,d.status,d.created_at,d.completed_at,
   p.full_name,p.username,null::integer files_total,null::integer files_erased
  from admin_ops.deletion_requests d left join public.profiles p on p.id=d.user_id
  union all
  select j.id,j.id,'self_service',j.user_id,j.reason,j.state,j.created_at,j.completed_at,
   null::text,null::text,j.object_count,j.deleted_count
  from account_erasure.jobs j where j.state='retention_review'
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)) from(
  select * from requests order by created_at desc,id,source limit 50 offset (p_page-1)*50) r),'[]'::jsonb),
  'total',(select count(*) from requests)) into result;
 return result;
end $$;
revoke all on function public.triniti_admin_deletion_requests(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.triniti_admin_deletion_requests(uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
