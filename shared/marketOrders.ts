export type MarketOrderStatus = 'requested' | 'awaiting_payment' | 'paid' | 'ready' | 'in_transit' | 'completed' | 'cancelled' | 'declined' | 'return_requested' | 'return_approved' | 'returned' | 'disputed';
export type MarketOrder = {
  id: string; buyer_id: string; seller_id: string; listing_id: string; conversation_id: string | null;
  title: string; image_url: string | null; quantity: number; unit_minor: string; delivery_minor: string; total_minor: string;
  currency: string; fulfilment: 'pickup' | 'delivery'; instructions: string; status: MarketOrderStatus;
  reservation: string; payment_id: string | null; version: number; created_at: string; updated_at: string; expires_at: string | null;
  events?: { id: number; kind: string; note: string; created_at: string }[];
};
export type OrderCursor = { created_at: string; id: string };
export type OrderPage = { rows: MarketOrder[]; has_more: boolean; next_cursor: OrderCursor | null };
export type OrderListing = { id: string; seller_id: string; status: string; delivery_available?: boolean; stock_quantity?: number; currency: string };
export type OrderAction = { id: string; label: string; note?: string };
export function orderMoney(minor: string, currency: string) {
  const n = BigInt(minor); const sign = n < BigInt(0) ? '-' : ''; const abs = n < BigInt(0) ? -n : n;
  return currency + ' ' + sign + (abs / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + (abs % BigInt(100)).toString().padStart(2, '0');
}
export const orderStatus: Record<MarketOrderStatus, string> = {
  requested: 'Awaiting seller confirmation', awaiting_payment: 'Awaiting payment', paid: 'Payment confirmed', ready: 'Ready for collection or dispatch',
  in_transit: 'Dispatched by seller', completed: 'Received by buyer', cancelled: 'Cancelled', declined: 'Declined',
  return_requested: 'Return requested', return_approved: 'Return approved', returned: 'Return received · refund not confirmed', disputed: 'Dispute open',
};
export function orderActions(order: MarketOrder, uid: string): OrderAction[] {
  if (uid !== order.buyer_id && uid !== order.seller_id) return [];
  const seller = uid === order.seller_id; const status = order.status;
  if (status === 'requested') return seller ? [{ id: 'accept', label: 'Accept order' }, { id: 'decline', label: 'Decline' }] : [{ id: 'cancel', label: 'Cancel request' }];
  if (status === 'awaiting_payment') return order.payment_id ? [] : [{ id: 'cancel', label: 'Cancel unpaid order' }];
  const actions: OrderAction[] = [];
  if (seller && status === 'paid') actions.push({ id: 'ready', label: order.fulfilment === 'pickup' ? 'Ready for pickup' : 'Ready to dispatch' });
  if (seller && status === 'ready' && order.fulfilment === 'delivery') actions.push({ id: 'dispatch', label: 'Record dispatch', note: 'Delivery arrangement and tracking/reference' });
  if (!seller && (status === 'in_transit' || (status === 'ready' && order.fulfilment === 'pickup'))) actions.push({ id: 'complete', label: 'Confirm received' });
  if (!seller && status === 'completed') actions.push({ id: 'request_return', label: 'Request return', note: 'Explain the reason for your return' });
  if (seller && status === 'return_requested') actions.push({ id: 'approve_return', label: 'Approve return', note: 'Give the buyer return instructions' });
  if (seller && status === 'return_approved') actions.push({ id: 'returned', label: 'Confirm return received' });
  if (['paid', 'ready', 'in_transit', 'completed', 'return_requested', 'return_approved', 'returned'].includes(status)) actions.push({ id: 'dispute', label: 'Report order problem', note: 'Describe the problem and the resolution you need' });
  return actions;
}
export function orderError(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
  const errors: Record<string, string> = {
    ORDER_TIMEOUT:'The result could not be confirmed. Refresh the order status, or retry the same request.',
    ACCOUNT_CHANGED: 'Your account changed. Refresh before continuing.', ORDER_CHANGED_REFRESH: 'This order changed. Refresh and review its latest status.',
    LISTING_UNAVAILABLE: 'This listing is unavailable or does not have enough stock.', INSUFFICIENT_STOCK: 'There is not enough stock to accept this order.',
    LISTING_CHANGED_REQUEST_NEW_ORDER: 'The listing price or delivery terms changed. Decline this request and ask the buyer for a new order.',
    PAYMENT_PENDING_CHECK_STATUS: 'A payment is still being checked. Check its status in Chat Pay before cancelling.', ORDER_NOT_PAYABLE: 'This order is no longer payable. Refresh its status.',
    ORDER_PAYMENT_MISMATCH: 'Payment details no longer match the order. Reopen the order before paying.',
    OPEN_ORDER_FROM_MARKETPLACE: 'Open the listing and choose an accepted order before paying.', MARKET_ORDER_REQUIRED: 'Request an order from the listing before paying.',
    DELIVERY_DETAILS_REQUIRED: 'Add delivery instructions before requesting this order.', ORDER_NOT_AVAILABLE: 'An order cannot be created with this account.',
  };
  return Object.entries(errors).find(([code]) => message.includes(code))?.[1] || 'Could not update the order. Refresh and try again.';
}
