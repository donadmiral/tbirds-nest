const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfirmedPaymentReceipt } = require('../src/services/paymentReceipt.ts');

const scope = { ownerId: 'sender-a', conversationId: 'chat-a', txId: 'tx-a' };
const payment = { id: 'payment-a', status: 'completed', tx_id: 'tx-a', sender_id: 'sender-a', conversation_id: 'chat-a' };
const receipt = { id: 'message-a', payment_id: 'payment-a', conversation_id: 'chat-a', sender_id: 'sender-a', media_type: 'payment', text: null, payment_receipt_verified: true };
function database(paymentResult = { data: payment }, receiptResult = { data: receipt }) {
  const reads = [];
  return {
    reads,
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(field, value) { filters.push([field, value]); return query; },
        async maybeSingle() {
          reads.push({ table, filters });
          return table === 'chat_payments' ? paymentResult : receiptResult;
        },
        insert() { throw new Error('Client must not create payment messages'); },
        update() { throw new Error('Client must not rewrite payment state'); },
      };
      return query;
    },
  };
}

test('realtime delivery and receipt refresh both use the same server message identity', async () => {
  const db = database();
  const first = await loadConfirmedPaymentReceipt(db, scope);
  const refreshed = await loadConfirmedPaymentReceipt(db, scope);
  assert.equal(first.id, 'message-a');
  assert.equal(refreshed.id, first.id);
  assert.equal(first.payment_id, 'payment-a');
  assert.deepEqual(db.reads[0].filters, [['sender_id', 'sender-a'], ['conversation_id', 'chat-a'], ['tx_id', 'tx-a']]);
  assert.deepEqual(db.reads[1].filters, [['payment_id', 'payment-a'], ['conversation_id', 'chat-a'], ['payment_receipt_verified', true]]);
});

test('pending, failed, mismatched and inaccessible payments cannot become receipt bubbles', async () => {
  for (const result of [
    { data: { ...payment, status: 'pending' } },
    { data: { ...payment, status: 'failed' } },
    { data: { ...payment, sender_id: 'someone-else' } },
    { data: { ...payment, tx_id: 'different-transaction' } },
    { data: null, error: { message: 'Permission denied' } },
  ]) {
    const db = database(result);
    await assert.rejects(loadConfirmedPaymentReceipt(db, scope), /not available/);
    assert.equal(db.reads.length, 1);
  }
});

test('a missing or text-only message is reported, never replaced with a fabricated receipt', async () => {
  for (const result of [
    { data: null }, { data: null, error: { message: 'Offline' } },
    { data: { ...receipt, payment_id: null, text: 'Sent USD 12.50', media_type: null } },
    { data: { ...receipt, conversation_id: 'different-chat' } },
    { data: { ...receipt, payment_receipt_verified: false } },
    { data: { ...receipt, payment_receipt_verified: undefined } },
  ]) {
    await assert.rejects(loadConfirmedPaymentReceipt(database({ data: payment }, result), scope), /still loading/);
  }
});
