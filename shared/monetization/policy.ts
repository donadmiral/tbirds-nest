import { validMinor } from './domain';
export const REVENUE_POLICY_VERSION = '2026-10-v1';
export const REVENUE_SHARES = {
  ads: 5500, subscription: 9000, tip: 10000, gift: 7000, sponsorship: 9000, marketplace: 9500,
} as const;
export type RevenueKind = keyof typeof REVENUE_SHARES;
export const REVENUE_LABELS: Record<RevenueKind,string> = {
  ads:'Eligible ad revenue',subscription:'Subscriptions',tip:'Genuine tips',gift:'Digital gifts',sponsorship:'Sponsorships',marketplace:'Marketplace sales',
};
/** Allocate only verified, collected eligible revenue. Inputs are minor-unit
 * decimal strings. Floor the creator share; the remainder stays with Platinum.
 * Genuine tips carry no Platinum commission or hidden processing deduction. */
export function allocateRevenue(kind: RevenueKind, grossMinor: string, deductionsMinor = '0') {
  if (!Object.hasOwn(REVENUE_SHARES,kind) || !validMinor(grossMinor,true) || !validMinor(deductionsMinor)) throw new Error('INVALID_REVENUE');
  const gross=BigInt(grossMinor),deductions=BigInt(deductionsMinor);
  if (deductions>gross || (kind==='tip' && deductions!==BigInt(0))) throw new Error('INVALID_REVENUE_DEDUCTIONS');
  const eligible=gross-deductions;
  const creator=eligible*BigInt(REVENUE_SHARES[kind])/BigInt(10000);
  return {policyVersion:REVENUE_POLICY_VERSION,kind,grossMinor,deductionsMinor,eligibleMinor:eligible.toString(),creatorMinor:creator.toString(),platformMinor:(eligible-creator).toString()};
}
