/** Live commerce and creator-finance mutations await the supported IntoBank
 * provider contract. The admin's read-only payment report has a separate release
 * path and does not enable payouts, purchase capture or creator approvals. */
export const CREATOR_COMMERCE_ENABLED = false;
export const FINANCE_OPERATIONS_ENABLED = false;
export const CREATOR_COMMERCE_UNAVAILABLE = 'Creator products and purchases are unavailable in this release.';
export const FINANCE_OPERATIONS_UNAVAILABLE = 'Advanced financial reporting and creator reviews are unavailable in this release.';
