-- PROPOSAL. Root review required before applying. No existing rows are rewritten.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.promoted_posts, public.ad_events, public.studio_campaigns IN SHARE ROW EXCLUSIVE MODE;
DO $preconditions$
DECLARE observed text;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Run as the reviewed postgres owner'; END IF;
  SELECT expected_md5 INTO observed FROM (with payload as (
select jsonb_build_object(
'tables',(select jsonb_agg(x order by x.name) from (
select c.relname as name, pg_get_userbyid(c.relowner) as owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text as acl,
(select jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
(select jsonb_agg(jsonb_build_object('name',co.conname,'definition',pg_get_constraintdef(co.oid)) order by co.conname) from pg_constraint co where co.conrelid=c.oid) as constraints,
(select jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',p.polroles::text,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid) as policies,
(select jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) as triggers
from pg_class c where c.oid in ('public.promoted_posts'::regclass,'public.ad_events'::regclass,'public.studio_campaigns'::regclass)) x),
'functions',(select jsonb_agg(x order by x.signature) from (
select p.oid::regprocedure::text as signature,pg_get_userbyid(p.proowner) as owner,p.proacl::text as acl,p.prosecdef,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('studio_add_ad','studio_remove_ad','studio_set_campaign_status','studio_save_campaign','studio_delete_campaign','studio_ads_watch','bump_ad_counters','record_ad_event','can_act_as')) x)
) as metadata)
select metadata,md5(metadata::text) as expected_md5 from payload) checked;
  IF observed IS DISTINCT FROM '1cdc327f50d4fc4bed46dd40952c4f0d' THEN
    RAISE EXCEPTION 'Promotion metadata changed. Re-review before applying. Observed: %', observed;
  END IF;
  IF to_regprocedure('public.pc_guard_promotion_client_write()') IS NOT NULL THEN
    RAISE EXCEPTION 'Guard name already exists. Do not replace it without review.';
  END IF;
END;
$preconditions$;

-- PROPOSAL ONLY. No billing/review rule for campaign-less quick promotions changes.
-- Existing grants/RLS continue to authorize the advertiser. This trigger adds
-- field integrity to direct API writes without trusting a JWT role claim.
CREATE FUNCTION public.pc_guard_promotion_client_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $guard$
BEGIN
  -- Effective SQL identity, not auth.jwt(). A trusted SECURITY DEFINER writer
  -- (the reviewed Studio RPCs and bump_ad_counters) runs as its database owner.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.campaign_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Add campaign ads from Studio.';
    END IF;
    IF NEW.impressions_count IS DISTINCT FROM 0
       OR NEW.clicks_count IS DISTINCT FROM 0
       OR NEW.notified_ending IS DISTINCT FROM false THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Promotion statistics are managed by the server.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = NEW.post_id AND p.user_id = NEW.advertiser_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Promote a post belonging to the selected account.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.post_id IS DISTINCT FROM OLD.post_id
       OR NEW.advertiser_id IS DISTINCT FROM OLD.advertiser_id
       OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.impressions_count IS DISTINCT FROM OLD.impressions_count
       OR NEW.clicks_count IS DISTINCT FROM OLD.clicks_count
       OR NEW.notified_ending IS DISTINCT FROM OLD.notified_ending THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Promotion ownership and statistics cannot be changed here.';
    END IF;
    IF OLD.campaign_id IS NOT NULL
       AND NEW.status = 'active'
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Resume this campaign from Studio.';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

-- No public callable API is added. Trigger execution does not require the
-- caller to retain EXECUTE once the trigger has been created.
REVOKE ALL ON FUNCTION public.pc_guard_promotion_client_write() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER pc_guard_promotion_client_write
BEFORE INSERT OR UPDATE ON public.promoted_posts
FOR EACH ROW EXECUTE FUNCTION public.pc_guard_promotion_client_write();

COMMIT;
