// Server only. Contract implemented by IntoBank's crisp_partner_payout_receipt.
// Live transfers are deliberately unavailable until the bank authorizes them.
export type Instruction = {
  id: string; creator_id: string; account_reference: string; provider_id: string;
  currency: string; amount_minor: string; environment: 'test';
  status: string; provider_reference: string | null; dispatch_started: boolean;
};
export type Outcome = {
  payout_id: string; provider_id: 'intobank'; environment: 'test'; event_id: string;
  reference: string; account_reference: string; currency: 'USD'; amount_minor: string;
  status: 'submitted' | 'unknown' | 'completed' | 'rejected';
};
type Options = { url: string; key: string; environment: string; fetcher: typeof fetch };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateInstruction(i: Instruction) {
  if (!i || !uuid.test(i.id) || !uuid.test(i.creator_id) || i.provider_id !== 'intobank' || i.environment !== 'test' || i.currency !== 'USD' ||
    !/^INTOBANK:[A-Za-z0-9+]{6,34}$/.test(i.account_reference) || !/^[1-9][0-9]{0,15}$/.test(i.amount_minor) || BigInt(i.amount_minor) > 9007199254740991n) {
    throw new Error('PAYOUT_INSTRUCTION_INVALID');
  }
}
export function parseReceipt(i: Instruction, value: unknown): Outcome | null {
  validateInstruction(i);
  const r = value as Record<string, any> | null;
  if (!r || r.success !== true || r.contract_version !== 'crisp-payout-v1' || r.environment !== 'test') throw new Error('PAYOUT_RECEIPT_INVALID');
  if (r.found === false) return null;
  const account = i.account_reference.slice('INTOBANK:'.length);
  if (r.found !== true || r.simulation !== true || !uuid.test(r.instruction_id) || r.partner_reference !== i.id ||
    (i.provider_reference && r.instruction_id !== i.provider_reference) || r.direction !== 'outbound' || r.currency !== i.currency ||
    r.amount_minor !== i.amount_minor || r.beneficiary?.account_number !== account || r.beneficiary?.institution?.code !== 'INTOBANK' ||
    typeof r.finality?.recipient_credited !== 'boolean' || typeof r.finality?.confirmed_not_sent !== 'boolean') throw new Error('PAYOUT_RECEIPT_MISMATCH');
  let status: Outcome['status'] = 'submitted';
  if (r.finality.recipient_credited && r.finality.confirmed_not_sent) throw new Error('PAYOUT_RECEIPT_MISMATCH');
  if (r.finality.recipient_credited) {
    if (r.status !== 'settled' || r.settlement_model !== 'same_bank' || r.credit?.confirmed !== true) throw new Error('PAYOUT_RECEIPT_MISMATCH');
    status = 'completed';
  } else if (r.finality.confirmed_not_sent) {
    if (r.status !== 'rejected') throw new Error('PAYOUT_RECEIPT_MISMATCH');
    status = 'rejected';
  } else if (r.status === 'unknown' || r.status === 'returned' || r.status === 'rejected' || r.status === 'settled') {
    status = 'unknown';
  } else if (!['initiated','review','submitted','accepted','confirmed'].includes(r.status)) throw new Error('PAYOUT_RECEIPT_MISMATCH');
  return {
    payout_id: i.id, provider_id: 'intobank', environment: 'test', reference: r.instruction_id,
    // Receipt identity describes canonical facts, not a new event for each poll.
    event_id: `${r.instruction_id}:${status}`, account_reference: i.account_reference,
    currency: 'USD', amount_minor: i.amount_minor, status,
  };
}
export function createIntoBankSandboxProvider(options: Options) {
  const base = new URL(options.url);
  if (options.environment !== 'test' || !options.key.startsWith('ck_test_') || base.protocol !== 'https:' || base.username || base.password || base.hash) {
    throw new Error('CREATOR_PAYOUT_PROVIDER_NOT_READY');
  }
  async function request(i: Instruction, submit: boolean, signal: AbortSignal): Promise<Outcome | null> {
    validateInstruction(i);
    const url = new URL(base);
    url.search = '';
    url.searchParams.set('endpoint', submit ? 'payouts' : 'payout');
    if (!submit) { url.searchParams.set('partner_reference', i.id); if (i.provider_reference) url.searchParams.set('id', i.provider_reference); }
    const padded = i.amount_minor.padStart(3, '0');
    const response = await options.fetcher(url.toString(), {
      method: submit ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${options.key}`, 'Content-Type': 'application/json' },
      ...(submit ? { body: JSON.stringify({ partner_reference: i.id, institution_code: 'INTOBANK',
        account_number: i.account_reference.slice('INTOBANK:'.length), currency: 'USD', amount: `${padded.slice(0,-2)}.${padded.slice(-2)}`,
        note: 'Platinum Circles creator payout' }) } : {}),
    });
    if (!response.ok) throw new Error('PAYOUT_PROVIDER_UNCONFIRMED');
    return parseReceipt(i, await response.json());
  }
  return { submit: (i: Instruction, signal: AbortSignal) => request(i, true, signal), reconcile: (i: Instruction, signal: AbortSignal) => request(i, false, signal) };
}
