// One-off protected Preview build, explicitly selected suite. Not an endpoint.
import {pathToFileURL} from 'node:url';
import {
  UUID, check, data, exactKeys, isRpcDenial, voidRpc, createIdentity,
  verifyIdentity, runGuarded, readCliInputs, sanitizedFailure,
} from './completion-qa-fixtures.mjs';

export async function requireNoMarketAlerts(ctx) {
  const result = await ctx.admin.from('market_alerts').select('id', {head: true, count: 'exact'});
  data(result, 'QA_MARKET_ALERT_INVENTORY_FAILED');
  check(result.count === 0, 'QA_EXISTING_MARKET_ALERTS_BLOCK_FIXTURE');
}

export function assertOfferCapabilities(value) {
  check(exactKeys(value, ['version', 'serialized', 'replay', 'fractionDigits', 'maxAmount'])
    && value.version === 1 && value.serialized === true && value.replay === false
    && value.fractionDigits === 2 && value.maxAmount === '9999999999.99', 'QA_OFFER_CAPABILITY_MISMATCH');
}

function assertOffer(row, {id, listing, seller, buyer, proposer, status, amount}) {
  check(row?.id === id && row.listing_id === listing && row.seller_id === seller && row.buyer_id === buyer
    && row.proposer_id === proposer && row.status === status && row.currency === 'USD'
    && (typeof row.amount === 'number' || typeof row.amount === 'string') && Number(row.amount) === amount,
    'QA_OFFER_READBACK_MISMATCH');
  check(status === 'pending' ? row.responded_at === null : typeof row.responded_at === 'string'
    && Number.isFinite(Date.parse(row.responded_at)), 'QA_OFFER_RESPONSE_TIMESTAMP_MISMATCH');
}
const OFFER_FIELDS = 'id,listing_id,buyer_id,seller_id,proposer_id,amount,currency,status,responded_at';
async function offerRead(member, id) {
  return data(await member.from('listing_offers').select(OFFER_FIELDS).eq('id', id).single(), 'QA_OFFER_READBACK_FAILED');
}

export function classifyOfferRace(results) {
  check(Array.isArray(results) && results.length === 2 && results.every(row => row.status === 'fulfilled'),
    'QA_OFFER_RACE_TRANSPORT_UNCONFIRMED');
  const successes = results.map((row, index) => ({index, value: row.value})).filter(row => !row.value?.error);
  check(successes.length === 1, 'QA_OFFER_RACE_SINGLE_WINNER_REQUIRED');
  const winner = successes[0].index, loser = 1 - winner;
  voidRpc(results[winner].value, 'QA_OFFER_RACE_ACK_INVALID');
  check(isRpcDenial(results[loser].value, '55000', 'OFFER_ALREADY_RESOLVED'), 'QA_OFFER_RACE_LOSER_UNCONFIRMED');
  return {winner, status: winner === 0 ? 'accepted' : 'withdrawn', loserCode: '55000'};
}

export async function exerciseOffers(ctx) {
  ctx.stage = 'market_alert_preflight';
  await requireNoMarketAlerts(ctx); // before even creating Auth fixtures
  const seller = await createIdentity(ctx, 'seller');
  const buyer = await createIdentity(ctx, 'buyer');
  const stranger = await createIdentity(ctx, 'stranger');
  ctx.stage = 'offer_capability_read';
  for (const actor of [seller, buyer, stranger]) {
    const capabilities = data(await actor.member.rpc('offer_response_capabilities'), 'QA_OFFER_CAPABILITY_FAILED');
    assertOfferCapabilities(capabilities);
    ctx.recordRpc(`offer_response_capabilities:${actor.label}`, capabilities);
  }
  const listingId = ctx.uuid(); check(UUID.test(listingId), 'QA_LISTING_ID_INVALID');
  const title = `Completion QA ${ctx.run}`;
  const listing = {id: listingId, seller_id: seller.id, title, description: 'Disposable synthetic offer acceptance fixture.',
    price: 12, currency: 'USD', category: 'Other', condition: 'New', location_city: 'QA fixture',
    images: [], delivery_available: false, delivery_fee: null, delivery_note: null};
  ctx.receipt.fixture = {listingId, title};
  ctx.cleanupActions.push({kind: 'listing', id: listingId, run: async () => {
    await verifyIdentity(ctx, seller.id);
    const existing = data(await ctx.admin.from('marketplace_listings').select('id,seller_id,title').eq('id', listingId).maybeSingle(), 'QA_LISTING_CLEANUP_READ_FAILED');
    if (existing !== null) {
      check(existing.id === listingId && existing.seller_id === seller.id && existing.title === title, 'QA_LISTING_CLEANUP_SCOPE_MISMATCH');
      data(await ctx.admin.from('marketplace_listings').delete().eq('id', listingId).eq('seller_id', seller.id).eq('title', title), 'QA_LISTING_CLEANUP_FAILED');
    }
    check(data(await ctx.admin.from('marketplace_listings').select('id').eq('id', listingId).maybeSingle(), 'QA_LISTING_ABSENCE_READ_FAILED') === null, 'QA_LISTING_STILL_PRESENT');
    const remaining = data(await ctx.admin.from('listing_offers').select('id').eq('listing_id', listingId), 'QA_OFFER_ABSENCE_READ_FAILED');
    check(Array.isArray(remaining) && remaining.length === 0, 'QA_OFFERS_STILL_PRESENT');
  }});
  // Register before make_offer: a lost acknowledgment can still have created a DM.
  ctx.cleanupActions.push({kind: 'conversation', id: listingId, run: async () => {
    await verifyIdentity(ctx, seller.id); await verifyIdentity(ctx, buyer.id);
    const rows = data(await ctx.admin.from('conversations').select('id,user_1,user_2,context,context_ref_id,is_group')
      .eq('context_ref_id', listingId), 'QA_CONVERSATION_CLEANUP_READ_FAILED');
    check(Array.isArray(rows) && rows.length <= 1, 'QA_CONVERSATION_CLEANUP_COUNT_MISMATCH');
    for (const row of rows) {
      check(UUID.test(row.id) && row.context === 'market' && row.context_ref_id === listingId && row.is_group === false
        && [row.user_1, row.user_2].sort().join(',') === [seller.id, buyer.id].sort().join(','), 'QA_CONVERSATION_CLEANUP_SCOPE_MISMATCH');
      data(await ctx.admin.from('conversations').delete().eq('id', row.id).eq('context', 'market').eq('context_ref_id', listingId), 'QA_CONVERSATION_CLEANUP_FAILED');
      check(data(await ctx.admin.from('conversations').select('id').eq('id', row.id).maybeSingle(), 'QA_CONVERSATION_ABSENCE_READ_FAILED') === null, 'QA_CONVERSATION_STILL_PRESENT');
      const messages = data(await ctx.admin.from('messages').select('id').eq('conversation_id', row.id), 'QA_MESSAGE_ABSENCE_READ_FAILED');
      check(Array.isArray(messages) && messages.length === 0, 'QA_MESSAGES_STILL_PRESENT');
    }
  }});
  ctx.stage = 'create_listing';
  // notify_market_alerts can target unrelated users. Stop if *any* alert exists;
  // never remove alerts or disable a production trigger to make this test pass.
  await requireNoMarketAlerts(ctx);
  const inserted = data(await seller.member.from('marketplace_listings').insert(listing).select('id,seller_id,title,status').single(), 'QA_LISTING_INSERT_FAILED');
  check(inserted?.id === listingId && inserted.seller_id === seller.id && inserted.title === title && inserted.status === 'available', 'QA_LISTING_ACK_MISMATCH');
  await requireNoMarketAlerts(ctx);
  ctx.check('listing_fixture_created_with_empty_alert_inventory');

  ctx.stage = 'make_offer';
  const offerId = data(await buyer.member.rpc('make_offer', {p_listing_id: listingId, p_amount: 10}), 'QA_MAKE_OFFER_FAILED');
  check(typeof offerId === 'string' && UUID.test(offerId), 'QA_MAKE_OFFER_ID_REQUIRED');
  ctx.recordRpc('make_offer', offerId);
  const expected = {id: offerId, listing: listingId, seller: seller.id, buyer: buyer.id, proposer: buyer.id, status: 'pending', amount: 10};
  for (const actor of [seller, buyer]) assertOffer(await offerRead(actor.member, offerId), expected);
  ctx.check('offer_id_acknowledged_and_both_participants_read_pending');

  ctx.stage = 'stranger_offer_denial';
  check(data(await stranger.member.from('listing_offers').select('id').eq('id', offerId).maybeSingle(), 'QA_STRANGER_OFFER_READ_FAILED') === null, 'QA_STRANGER_CAN_READ_OFFER');
  const denied = await stranger.member.rpc('respond_offer', {p_offer_id: offerId, p_action: 'accepted', p_counter_amount: null});
  check(isRpcDenial(denied, 'P0002', 'OFFER_NOT_FOUND'), 'QA_STRANGER_OFFER_RESPONSE_DENIAL_UNCONFIRMED');
  ctx.check('nonparticipant_read_and_response_denied');

  const conversations = data(await seller.member.from('conversations').select('id,user_1,user_2,context,context_ref_id,is_group')
    .eq('context_ref_id', listingId), 'QA_OFFER_CONVERSATION_READ_FAILED');
  check(Array.isArray(conversations) && conversations.length === 1 && UUID.test(conversations[0].id)
    && conversations[0].context === 'market' && conversations[0].is_group === false
    && [conversations[0].user_1, conversations[0].user_2].sort().join(',') === [seller.id, buyer.id].sort().join(','), 'QA_OFFER_CONVERSATION_MISMATCH');
  const conversationId = conversations[0].id;
  const messages = async actor => data(await actor.member.from('messages').select('id,sender_id,receiver_id,text,media_type,media_url,is_system_message')
    .eq('conversation_id', conversationId).order('created_at', {ascending: true}), 'QA_OFFER_MESSAGES_READ_FAILED');
  const before = await messages(seller);
  check(Array.isArray(before) && before.length === 1 && before[0].media_type === 'offer', 'QA_INITIAL_OFFER_MESSAGE_MISMATCH');
  let metadata; try { metadata = JSON.parse(before[0].media_url); } catch { check(false, 'QA_INITIAL_OFFER_MESSAGE_INVALID'); }
  check(metadata.offer_id === offerId && metadata.listing_id === listingId && metadata.status === 'pending'
    && Number(metadata.amount) === 10 && before[0].sender_id === buyer.id && before[0].receiver_id === seller.id,
    'QA_INITIAL_OFFER_MESSAGE_MISMATCH');

  ctx.stage = 'concurrent_offer_response';
  const dispatchStartedAt = new Date(ctx.now()).toISOString();
  const results = await Promise.allSettled([
    seller.member.rpc('respond_offer', {p_offer_id: offerId, p_action: 'accepted', p_counter_amount: null}),
    buyer.member.rpc('respond_offer', {p_offer_id: offerId, p_action: 'withdrawn', p_counter_amount: null}),
  ]);
  const race = classifyOfferRace(results);
  ctx.recordRpc('respond_offer_concurrent', {dispatchStartedAt, completedAt: new Date(ctx.now()).toISOString(),
    winner: race.winner === 0 ? 'seller' : 'buyer', status: race.status, loserCode: race.loserCode,
    scope: 'Concurrent client requests; no claim that server lock acquisition overlapped.'});
  for (const actor of [seller, buyer]) assertOffer(await offerRead(actor.member, offerId), {...expected, status: race.status});
  const after = await messages(seller), otherView = await messages(buyer);
  check(Array.isArray(after) && after.length === before.length + 1 && JSON.stringify(after) === JSON.stringify(otherView), 'QA_OFFER_SINGLE_MESSAGE_READBACK_MISMATCH');
  const added = after.filter(row => !before.some(prior => prior.id === row.id));
  const winner = race.winner === 0 ? seller : buyer, recipient = race.winner === 0 ? buyer : seller;
  check(added.length === 1 && UUID.test(added[0].id) && added[0].is_system_message === true
    && added[0].sender_id === winner.id && added[0].receiver_id === recipient.id
    && added[0].text === (race.status === 'accepted' ? '✅ Offer accepted' : 'Offer withdrawn'), 'QA_OFFER_TRANSITION_MESSAGE_MISMATCH');
  ctx.check('concurrent_responses_have_one_committed_transition_and_message', {winner: winner.label, status: race.status});

  ctx.stage = 'repeat_resolved_offer';
  const repeated = await winner.member.rpc('respond_offer', {p_offer_id: offerId, p_action: race.status, p_counter_amount: null});
  check(isRpcDenial(repeated, '55000', 'OFFER_ALREADY_RESOLVED'), 'QA_OFFER_REPEAT_DENIAL_UNCONFIRMED');
  assertOffer(await offerRead(seller.member, offerId), {...expected, status: race.status});
  check(JSON.stringify(await messages(seller)) === JSON.stringify(after), 'QA_OFFER_REPEAT_DUPLICATED_MESSAGE');
  ctx.check('resolved_repeat_rejected_without_duplicate_message');
}

export function assertSupportReceipt(value, {requestId, ticketId, ownerId, body, replayed, status}) {
  check(exactKeys(value, ['message_id', 'ticket_id', 'sender_id', 'body', 'created_at', 'ticket_status', 'replayed'])
    && value.message_id === requestId && value.ticket_id === ticketId && value.sender_id === ownerId && value.body === body
    && typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at))
    && value.ticket_status === status && value.replayed === replayed, 'QA_SUPPORT_RECEIPT_MISMATCH');
}

export async function exerciseSupport(ctx) {
  const owner = await createIdentity(ctx, 'owner'), stranger = await createIdentity(ctx, 'stranger');
  const ticketId = ctx.uuid(), requestId = ctx.uuid();
  check(UUID.test(ticketId) && UUID.test(requestId) && ticketId !== requestId, 'QA_SUPPORT_FIXTURE_ID_INVALID');
  const subject = `Completion QA ${ctx.run}`, question = 'Disposable synthetic support question.', body = `Synthetic member reply ${ctx.run}`;
  ctx.receipt.fixture = {ticketId, requestId, subject};
  ctx.cleanupActions.push({kind: 'support_ticket', id: ticketId, run: async () => {
    await verifyIdentity(ctx, owner.id);
    const row = data(await ctx.admin.from('support_tickets').select('id,user_id,subject,body').eq('id', ticketId).maybeSingle(), 'QA_SUPPORT_CLEANUP_READ_FAILED');
    if (row !== null) {
      check(row.id === ticketId && row.user_id === owner.id && row.subject === subject && row.body === question, 'QA_SUPPORT_CLEANUP_SCOPE_MISMATCH');
      data(await ctx.admin.from('support_tickets').delete().eq('id', ticketId).eq('user_id', owner.id).eq('subject', subject), 'QA_SUPPORT_CLEANUP_FAILED');
    }
    check(data(await ctx.admin.from('support_tickets').select('id').eq('id', ticketId).maybeSingle(), 'QA_SUPPORT_ABSENCE_READ_FAILED') === null, 'QA_SUPPORT_TICKET_STILL_PRESENT');
    const remaining = data(await ctx.admin.from('support_messages').select('id').eq('ticket_id', ticketId), 'QA_SUPPORT_MESSAGE_ABSENCE_READ_FAILED');
    check(Array.isArray(remaining) && remaining.length === 0, 'QA_SUPPORT_MESSAGES_STILL_PRESENT');
  }});
  ctx.stage = 'create_support_ticket';
  const ticket = data(await owner.member.from('support_tickets').insert({id: ticketId, user_id: owner.id,
    kind: 'support', subject, body: question}).select('id,user_id,subject,body,status').single(), 'QA_SUPPORT_CREATE_FAILED');
  check(ticket?.id === ticketId && ticket.user_id === owner.id && ticket.subject === subject && ticket.body === question && ticket.status === 'open', 'QA_SUPPORT_CREATE_ACK_MISMATCH');
  const history = async actor => data(await actor.member.from('support_messages').select('id,ticket_id,sender,sender_id,body,created_at')
    .eq('ticket_id', ticketId).order('created_at', {ascending: true}), 'QA_SUPPORT_HISTORY_READ_FAILED');
  const initial = await history(owner); check(Array.isArray(initial), 'QA_SUPPORT_HISTORY_INVALID');
  ctx.check('owned_support_ticket_created');

  const solveExactFixture = async () => {
    await verifyIdentity(ctx, owner.id);
    const solved = data(await ctx.admin.from('support_tickets').update({status: 'solved'}).eq('id', ticketId)
      .eq('user_id', owner.id).eq('subject', subject).select('id,user_id,subject,status').single(), 'QA_SUPPORT_SOLVED_SETUP_FAILED');
    check(solved?.id === ticketId && solved.user_id === owner.id && solved.subject === subject && solved.status === 'solved', 'QA_SUPPORT_SOLVED_SETUP_MISMATCH');
  };
  ctx.stage = 'solve_owned_support_fixture'; await solveExactFixture();
  const args = {p_expected_user: owner.id, p_ticket_id: ticketId, p_request_id: requestId, p_body: body};
  ctx.stage = 'member_support_reply';
  const first = data(await owner.member.rpc('send_member_support_reply', args), 'QA_SUPPORT_REPLY_FAILED');
  assertSupportReceipt(first, {requestId, ticketId, ownerId: owner.id, body, replayed: false, status: 'open'});
  ctx.recordRpc('send_member_support_reply:first', first);
  const updated = data(await owner.member.from('support_tickets').select('id,status').eq('id', ticketId).single(), 'QA_SUPPORT_OPEN_READ_FAILED');
  const after = await history(owner), added = after.filter(row => !initial.some(prior => prior.id === row.id));
  check(updated.id === ticketId && updated.status === 'open' && after.length === initial.length + 1 && added.length === 1
    && added[0].id === requestId && added[0].ticket_id === ticketId && added[0].sender_id === owner.id && added[0].sender === 'member'
    && added[0].body === body && added[0].created_at === first.created_at, 'QA_SUPPORT_ATOMIC_READBACK_MISMATCH');
  ctx.check('new_member_reply_persisted_once_and_reopened_ticket');

  ctx.stage = 'replay_member_support_reply'; await solveExactFixture();
  const replay = data(await owner.member.rpc('send_member_support_reply', args), 'QA_SUPPORT_REPLAY_FAILED');
  assertSupportReceipt(replay, {requestId, ticketId, ownerId: owner.id, body, replayed: true, status: 'solved'});
  check(replay.created_at === first.created_at, 'QA_SUPPORT_REPLAY_TIMESTAMP_CHANGED');
  ctx.recordRpc('send_member_support_reply:replay', replay);
  const stillSolved = data(await owner.member.from('support_tickets').select('id,status').eq('id', ticketId).single(), 'QA_SUPPORT_REPLAY_READ_FAILED');
  check(stillSolved.id === ticketId && stillSolved.status === 'solved' && JSON.stringify(await history(owner)) === JSON.stringify(after), 'QA_SUPPORT_REPLAY_MUTATED_DATA');
  ctx.check('same_request_replay_recovers_receipt_without_reopening_or_duplicate');

  ctx.stage = 'conflicting_member_support_reply';
  const conflict = await owner.member.rpc('send_member_support_reply', {...args, p_body: `${body} changed`});
  check(isRpcDenial(conflict, '22023', 'SUPPORT_REQUEST_CONFLICT'), 'QA_SUPPORT_CONFLICT_DENIAL_UNCONFIRMED');
  const foreign = await stranger.member.rpc('send_member_support_reply', {...args, p_expected_user: stranger.id, p_request_id: ctx.uuid()});
  check(isRpcDenial(foreign, '42501', 'SUPPORT_TICKET_UNAVAILABLE'), 'QA_SUPPORT_FOREIGN_REPLY_DENIAL_UNCONFIRMED');
  check(data(await stranger.member.from('support_tickets').select('id').eq('id', ticketId).maybeSingle(), 'QA_SUPPORT_FOREIGN_READ_FAILED') === null,
    'QA_SUPPORT_FOREIGN_TICKET_VISIBLE');
  const foreignHistory = await history(stranger);
  check(Array.isArray(foreignHistory) && foreignHistory.length === 0 && JSON.stringify(await history(owner)) === JSON.stringify(after), 'QA_SUPPORT_FOREIGN_HISTORY_OR_MUTATION');
  const final = data(await owner.member.from('support_tickets').select('id,status').eq('id', ticketId).single(), 'QA_SUPPORT_FINAL_READ_FAILED');
  check(final.id === ticketId && final.status === 'solved', 'QA_SUPPORT_DENIAL_REOPENED_TICKET');
  ctx.check('conflicting_replay_and_nonparticipant_access_denied');
  ctx.receipt.fixtureSetupScope = 'Only the exact marked ticket status was set to solved by the server client; this does not claim an operations UI journey.';
}

export async function runInteractionsAcceptance(options) {
  check(['offers', 'support'].includes(options?.suite), 'QA_INTERACTION_SUITE_REQUIRED');
  return runGuarded({...options, execute: options.suite === 'offers' ? exerciseOffers : exerciseSupport});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let receipt;
  try {
    const input = await readCliInputs(process.argv), at = process.argv.indexOf('--suite'), suite = process.argv[at + 1];
    check(at >= 0 && ['offers', 'support'].includes(suite), 'QA_INTERACTION_SUITE_REQUIRED');
    const {createClient} = await import('@supabase/supabase-js');
    receipt = await runInteractionsAcceptance({...input, suite, clientFactory: createClient});
  } catch (error) { receipt = {schemaVersion: 1, mutationStarted: false, allChecksPassed: false, failure: sanitizedFailure(error, 'preflight')}; }
  console.log('PLATINUM_QA_INTERACTIONS_RECEIPT=' + JSON.stringify(receipt));
  if (!receipt.allChecksPassed) process.exitCode = 1;
}
