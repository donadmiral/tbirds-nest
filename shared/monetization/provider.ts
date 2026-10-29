/** Server-only provider contract. This module never infers settlement from a
 * client callback, connection badge, accepted request or generic HTTP success. */
import { PRIMARY_PAYOUT_PROVIDER, validMinor } from './domain';
export type PayoutInstruction = {
  id: string; creatorId: string; accountReference: string; providerId: string; currency: string; amountMinor: string;
};
export type VerifiedPayoutOutcome = {
  eventId: string; reference: string; payoutId: string; accountReference: string;
  providerId: string; currency: string; amountMinor: string;
  status: 'submitted' | 'unknown' | 'completed' | 'rejected';
};
export interface CreatorPayoutProvider {
  readonly id: string;
  readonly supportsPayouts: boolean;
  submit(instruction: PayoutInstruction): Promise<VerifiedPayoutOutcome>;
  reconcile(instruction: PayoutInstruction): Promise<VerifiedPayoutOutcome>;
}
export class PayoutProviderUnavailable extends Error {
  readonly code = 'PAYOUT_PROVIDER_NOT_READY';
  constructor() { super('IntoBank creator payouts are not available yet. No transfer was submitted.'); }
}
/** The current IntoBank/Crisp P2P API is not a creator-disbursement contract.
 * Do not route creator funding through a member's chat payment or fake a receipt.
 * Replace this adapter only after the bank exposes approved funding, beneficiary,
 * idempotency and canonical settlement/rejection APIs. No fallback is implicit. */
export const intoBankCreatorProvider: CreatorPayoutProvider = Object.freeze({
  id: PRIMARY_PAYOUT_PROVIDER,
  supportsPayouts: false,
  async submit(_instruction: PayoutInstruction): Promise<VerifiedPayoutOutcome> { throw new PayoutProviderUnavailable(); },
  async reconcile(_instruction: PayoutInstruction): Promise<VerifiedPayoutOutcome> { throw new PayoutProviderUnavailable(); },
});
export function creatorPayoutProvider(id = PRIMARY_PAYOUT_PROVIDER): CreatorPayoutProvider {
  if (id !== PRIMARY_PAYOUT_PROVIDER) throw new Error('Unsupported creator payout provider. No transfer was submitted.');
  return intoBankCreatorProvider;
}
/** Check trusted adapter output against the immutable DB instruction before
 * invoking reconciliation. Signature verification belongs inside the adapter. */
export function assertMatchingOutcome(instruction: PayoutInstruction, outcome: VerifiedPayoutOutcome): void {
  if (!validMinor(instruction.amountMinor, true) || !validMinor(outcome.amountMinor, true) ||
    !instruction.accountReference || !instruction.id || !outcome.eventId || !outcome.reference ||
    instruction.providerId !== outcome.providerId || instruction.id !== outcome.payoutId ||
    instruction.accountReference !== outcome.accountReference || instruction.currency !== outcome.currency ||
    instruction.amountMinor !== outcome.amountMinor || !['submitted', 'unknown', 'completed', 'rejected'].includes(outcome.status)) {
    throw new Error('PAYOUT_RECEIPT_MISMATCH');
  }
}
