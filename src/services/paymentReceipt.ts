/** Read the receipt created by the database's completed-payment trigger. */
export async function loadConfirmedPaymentReceipt(
  db: any,
  scope: { ownerId: string; conversationId: string; txId: string },
): Promise<Record<string, any>> {
  if (!scope.ownerId || !scope.conversationId || !scope.txId) throw new Error('Payment reference required');
  const payment = await db.from('chat_payments')
    .select('id,status,tx_id,sender_id,conversation_id')
    .eq('sender_id', scope.ownerId).eq('conversation_id', scope.conversationId)
    .eq('tx_id', scope.txId).maybeSingle();
  if (payment.error || !payment.data || payment.data.status !== 'completed' ||
      payment.data.tx_id !== scope.txId || payment.data.sender_id !== scope.ownerId ||
      payment.data.conversation_id !== scope.conversationId) {
    throw new Error('The confirmed payment receipt is not available yet');
  }
  const receipt = await db.from('messages')
    .select('id,text,sender_id,receiver_id,conversation_id,created_at,media_type,payment_id,payment_receipt_verified')
    .eq('payment_id', payment.data.id).eq('conversation_id', scope.conversationId)
    .eq('payment_receipt_verified', true).maybeSingle();
  if (receipt.error || !receipt.data || receipt.data.payment_id !== payment.data.id ||
      receipt.data.conversation_id !== scope.conversationId || receipt.data.sender_id !== scope.ownerId ||
      receipt.data.media_type !== 'payment' || receipt.data.payment_receipt_verified !== true) {
    throw new Error('The chat receipt is still loading');
  }
  return receipt.data;
}
