-- Canonical partner receipts. Requires the existing network and Part 39 records.
-- This migration changes no bank policy, funding, keys, balances or live gate.
begin;
create or replace function public.crisp_partner_payout_receipt(
  p_partner uuid, p_instruction uuid default null, p_partner_reference text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  i triniti_network_private.instructions;
  partner public.crisp_partners;
  b public.crisp_beneficiaries;
  institution public.crisp_institutions;
  ref text;
  credited boolean;
  not_sent boolean;
begin
  select * into partner from public.crisp_partners where id=p_partner and status='active';
  if not found then raise exception 'INVALID_PARTNER'; end if;
  if (p_instruction is null and nullif(p_partner_reference,'') is null)
    or length(p_partner_reference)>100 then raise exception 'INVALID_QUERY'; end if;
  -- Old Edge versions omitted reference from the command payload. Recover
  -- these by the partner-scoped immutable command result, never by fuzzy search.
  select x.* into i from triniti_network_private.instructions x
  where x.partner_id=p_partner and (p_instruction is null or x.id=p_instruction)
    and (p_partner_reference is null or x.partner_reference=p_partner_reference or exists (
      select 1 from triniti_payment_private.commands c
      where c.actor_id=p_partner and c.operation='network_partner_payout' and c.request_key=p_partner_reference
        and c.result->>'instruction_id'=x.id::text
    )) order by x.id limit 1;
  if not found then return jsonb_build_object('success',true,'contract_version','crisp-payout-v1','found',false,'environment',partner.environment); end if;
  select * into b from public.crisp_beneficiaries where id=i.beneficiary_id;
  select * into institution from public.crisp_institutions where id=b.institution_id;
  ref:=coalesce(i.partner_reference,(select c.request_key from triniti_payment_private.commands c
    where c.actor_id=p_partner and c.operation='network_partner_payout' and c.result->>'instruction_id'=i.id::text order by c.request_key limit 1));
  credited:=i.direction='outbound' and i.status='settled' and i.journal_id is not null
    and ((i.settlement_model='same_bank' and i.confirmed_at is not null)
      or (i.settlement_model='prefunded' and i.settlement_ref is not null and i.credited_at is not null and i.credit_confirmed_at is not null));
  not_sent:=i.status='rejected' and i.journal_id is null and i.settlement_ref is null and i.credited_at is null
    and exists(select 1 from triniti_payment_private.reservations r where r.instrument_id=i.reservation_id and r.status='released');
  return triniti_network_private.instruction_json(i) || jsonb_build_object(
    'success',true,'found',true,'contract_version','crisp-payout-v1','environment',partner.environment,
    'simulation',partner.environment='test','partner_reference',ref,
    'amount_minor',trunc(i.amount*100)::text,'fee_minor',trunc(i.fee*100)::text,
    'beneficiary',jsonb_build_object('account_number',b.account_number,'institution',jsonb_build_object('code',institution.code)),
    'finality',jsonb_build_object('recipient_credited',coalesce(credited,false),'confirmed_not_sent',coalesce(not_sent,false)));
end $$;
revoke all on function public.crisp_partner_payout_receipt(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crisp_partner_payout_receipt(uuid,uuid,text) to service_role;
commit;
