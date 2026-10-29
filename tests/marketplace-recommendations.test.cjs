const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const scope = { exports: {}, Intl, AbortController };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/marketplaceRecommendations.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, scope);
const { isMarketplacePost, marketplacePrice, marketplaceReputation, readMarketplaceRecommendations } = scope.exports;
const listing = '20000000-0000-4000-8000-000000000001';

test('restored feed pages identify market attachments while retaining jobs and other product links', () => {
  assert.equal(isMarketplacePost({ products: [{ listing_id: listing }] }), true);
  assert.equal(isMarketplacePost({ products: [{ link_url: `/market/${listing}?from=feed` }] }), true);
  assert.equal(isMarketplacePost({ products: [{ link_url: `/market/${listing}#details` }] }), true);
  for (const row of [{}, { products: null }, { products: {} }, { products: [null] }, { products: [{ listing_id: '', link_url: `/jobs/${listing}` }] }, { products: [{ link_url: 'https://example.test/product' }] }]) {
    assert.equal(isMarketplacePost(row), false);
  }
});

test('market cards show actual purchase ratings or a truthful seller label', () => {
  assert.equal(marketplaceReputation({ rating: '4.75', review_count: 12, seller_verified: true }), '4.8 (12)');
  assert.equal(marketplaceReputation({ rating: null, review_count: 0, seller_verified: true }), 'Verified seller');
  assert.equal(marketplaceReputation({ rating: 5, review_count: 0, seller_verified: false }), 'New seller');
  assert.equal(marketplaceReputation({ rating: NaN, review_count: 4, seller_verified: false }), 'New seller');
  assert.equal(marketplacePrice({ price: '0', currency: 'USD' }), '$0.00');
  assert.equal(marketplacePrice({ price: '-4', currency: 'USD' }), 'View price');
  assert.equal(marketplacePrice({ price: 'bad', currency: 'USD' }), 'View price');
});

test('recommendation reads forward cancellation, bound visible cards, and reject unusable media', async () => {
  const controller = new AbortController(); let called, forwarded;
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: 'Item', image_url: 'https://example.test/photo.jpg', price: '10.00' }));
  rows.unshift({ id: 'insecure', title: 'Bad image', image_url: 'http://example.test/photo.jpg', price: 2 });
  rows.unshift({ id: 'invalid', title: 'Bad price', image_url: 'https://example.test/photo.jpg', price: -2 });
  const query = Promise.resolve({ data: rows, error: null }); query.abortSignal = signal => { forwarded = signal; return query; };
  const cards = await readMarketplaceRecommendations({ rpc(name, args) { called = { name, args }; return query; } }, controller.signal);
  assert.equal(called.name, 'home_marketplace_recommendations'); assert.equal(called.args.p_limit, 8);
  assert.equal(forwarded, controller.signal); assert.equal(cards.length, 8); assert.equal(cards[0].id, '0');
});

test('failed recommendations remain an error instead of inventing an empty successful catalog', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(() => readMarketplaceRecommendations({ rpc: () => Promise.resolve({ data: null, error: { message: 'Database detail' } }) }, signal), /could not load/);
  await assert.rejects(() => readMarketplaceRecommendations({ rpc: () => Promise.resolve({ data: {}, error: null }) }, signal), /unavailable/);
});
