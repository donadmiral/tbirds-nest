export { readCreatorSnapshot, registerCreatorInterest, applyToCreatorProgram, withFinanceDeadline } from "../../../shared/monetization/client";
export { ENROLLMENT_LABELS, BALANCE_LABELS, PAYOUT_LABELS, formatMinor, payoutBlockReason, earningActivityLabel } from "../../../shared/monetization/domain";
export type { CreatorSnapshot } from "../../../shared/monetization/domain";
export async function readIntoBankLink() { return false; }
export async function linkIntoBankAccount() { throw new Error("No provider is connected in this synthetic verification."); }
