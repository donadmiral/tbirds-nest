const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

// Unit boundary: the handler independently owns request authentication, fixed
// Daily URLs, response bounds and the per-operation deadline. No network here.
class ProviderFailure extends Error {
  constructor(code, providerStatus, providerError, providerReason) {
    super(code); this.providerStatus = providerStatus; this.providerError = providerError; this.providerReason = providerReason;
  }
}
function load(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../functions', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Date, require(name) {
    if (name in imports) return imports[name]; throw Error(name);
  } });
  return module.exports;
}
const { verifyStorage } = load('live-provider-configure/storage.ts', { './handler.ts': { ProviderFailure } });
const { hlsEndpoint } = load('live-core/provider.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const operationId = '10000000-0000-4000-8000-000000000001';
const roomName = 'pc-live-verify-' + operationId.replaceAll('-', '');
const roomPath = '/rooms/' + roomName;
const now = Date.parse('2026-11-03T12:00:00Z');
const values = { operationId, bucket: 'synthetic-live-bucket', region: 'us-east-2',
  assumeRoleArn: 'arn:aws:iam::123456789012:role/SyntheticDailyWriter', endpointName: 'platinum-live' };
function harness(options = {}) {
  const calls = [], cleanups = [];
  let room = options.existing ? { name: roomName } : null;
  let posts = 0;
  const deps = { ...values, ...options.config, now: () => now,
    call: async (requestPath, method, body, timeoutMs) => {
      const call = { path: requestPath, method, body: body && plain(body), timeoutMs }; calls.push(call);
      if (method === 'GET') {
        if (options.getError) throw options.getError;
        if (!room) throw new ProviderFailure('PROVIDER_REQUEST_REJECTED', 404, 'unclassified');
        return options.readRoom ? options.readRoom(plain(room), calls) : plain(room);
      }
      assert.equal(method, 'POST');
      if (requestPath === '/rooms') {
        if (options.createRejected) throw new ProviderFailure('PROVIDER_REQUEST_REJECTED', options.createRejected, 'private-create-error');
        room = { id: '20000000-0000-4000-8000-000000000001', name: body.name, privacy: body.privacy, config: plain(body.properties) };
        if (options.afterCreate) options.afterCreate(room);
        if (options.createAmbiguous) throw new ProviderFailure('PROVIDER_REQUEST_FAILED', 503, 'secret-provider-code');
        return options.createResponse ? options.createResponse(plain(room)) : plain(room);
      }
      assert.equal(requestPath, roomPath);
      posts++;
      if (options.rejectPost === posts) throw new ProviderFailure('PROVIDER_REQUEST_REJECTED', 403,
        'synthetic-private-key https://private.invalid/?token=secret');
      Object.assign(room.config, plain(body.properties));
      return plain(room);
    },
    cleanup: async requestPath => {
      cleanups.push(requestPath);
      if (options.cleanupError) throw options.cleanupError;
      if (options.cleanupResult !== undefined) return options.cleanupResult;
      room = null;
      return { deleted: true, name: roomName };
    },
  };
  return { deps, calls, cleanups, room: () => room, run: () => verifyStorage(deps) };
}
async function fails(h, code) {
  try { await h.run(); assert.fail('Expected verification failure'); }
  catch (error) { assert.ok(error instanceof ProviderFailure); assert.equal(error.message, code); return error; }
}

test('isolated storage verification never starts a meeting or stream and deletes its own room', async () => {
  const h = harness(), result = plain(await h.run());
  assert.deepEqual(result, { receipt: { code: 'STORAGE_VERIFIED', resource_id: operationId, mutation_attempted: true,
    configuration_matches: true, cleanup_confirmed: true }, metadata: { room_name: roomName,
    recordings_bucket_verified: true, hls_configuration_verified: true, broadcast_started: false, cleanup_confirmed: true } });
  assert.deepEqual(h.calls.map(call => [call.method, call.path]), [
    ['GET', roomPath], ['POST', '/rooms'], ['POST', roomPath], ['POST', roomPath], ['GET', roomPath],
  ]);
  assert.deepEqual(h.cleanups, [roomPath]); assert.equal(h.room(), null);
  const created = h.calls[1].body;
  assert.equal(created.privacy, 'private'); assert.equal(created.properties.exp, now / 1000 + 300);
  assert.equal(created.properties.eject_at_room_exp, true); assert.equal(created.properties.enable_knocking, false);
  assert.equal(created.properties.max_participants, 1);
  assert.equal(created.properties.start_audio_off, true); assert.equal(created.properties.start_video_off, true);
  assert.equal(created.properties.enable_screenshare, false);
  assert.ok(h.calls.every(call => call.timeoutMs > 0 && call.timeoutMs <= 15000));
});

test('documented bucket probe uses exact configured AWS target and disables Daily access links', async () => {
  const h = harness(); await h.run();
  assert.deepEqual(h.calls[2].body, { properties: { recordings_bucket: {
    bucket_name: values.bucket, bucket_region: values.region, assume_role_arn: values.assumeRoleArn, allow_api_access: false,
  } } });
  // Keep this probe aligned with the actual production HLS configuration.
  const expected = hlsEndpoint(values, { session_id: operationId, recording_enabled: true });
  assert.deepEqual(h.calls[3].body.properties.streaming_endpoints, plain([expected]));
  assert.equal(JSON.stringify(h.calls).includes('live-streaming/start'), false);
  assert.equal(JSON.stringify(h.calls).includes('recordings/start'), false);
});

test('invalid configuration is rejected before any provider request or cleanup', async () => {
  for (const config of [ { operationId: '../other-room' }, { bucket: 'https://private.invalid' }, { bucket: '127.0.0.1' },
    { bucket: 'synthetic..bucket' }, { region: 'us-east-2/elsewhere' }, { assumeRoleArn: 'arn:aws:iam::123:root' },
    { endpointName: '../other-endpoint' } ]) {
    const h = harness({ config }); await fails(h, 'PROVIDER_CONFIG_INVALID');
    assert.equal(h.calls.length, 0); assert.equal(h.cleanups.length, 0);
  }
});

test('a preexisting room is never reconfigured or deleted', async () => {
  const h = harness({ existing: true }), error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
  assert.equal(h.calls.length, 1); assert.equal(h.cleanups.length, 0);
  assert.equal(error.receipt.mutation_attempted, false); assert.equal(error.receipt.cleanup_confirmed, undefined);
});

test('initial access or network errors cannot lead to creation and expose no raw error', async () => {
  for (const getError of [new ProviderFailure('PROVIDER_REQUEST_REJECTED', 401, 'secret-code'),
    new Error('Authorization: Bearer synthetic-private-token')]) {
    const h = harness({ getError }), error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
    assert.equal(h.calls.length, 1); assert.equal(h.cleanups.length, 0);
    assert.equal(JSON.stringify(error).includes('secret-code'), false);
    assert.equal(JSON.stringify(error).includes('synthetic-private-token'), false);
  }
});

test('create rejection or collision never grants permission to delete an existing room', async () => {
  for (const createRejected of [400, 401, 403, 409, 429]) {
    const h = harness({ createRejected }), error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
    assert.equal(h.calls.length, 2); assert.equal(h.cleanups.length, 0);
    assert.equal(error.receipt.mutation_attempted, true); assert.equal(error.receipt.cleanup_confirmed, undefined);
    assert.equal(error.providerStatus, createRejected); assert.equal(error.providerError, 'unclassified');
  }
});

test('storage permission failure cleans up and returns only a fixed error and numeric status', async () => {
  const h = harness({ rejectPost: 1 }), error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
  assert.equal(error.providerStatus, 403); assert.equal(error.providerError, 'unclassified');
  assert.equal(error.receipt.configuration_matches, false); assert.equal(error.receipt.cleanup_confirmed, true);
  assert.deepEqual(h.cleanups, [roomPath]); assert.equal(h.calls.length, 3);
  assert.equal(JSON.stringify(error).includes('synthetic-private-key'), false);
  assert.equal(JSON.stringify(error).includes('private.invalid'), false);
});

test('only enumerated provider codes and reason categories survive storage error wrapping', async () => {
  for (const providerReason of ['billing_required', 'role_assumption_denied', 'storage_access_denied', 'configuration_invalid', 'unclassified']) {
    const h = harness({ getError: new ProviderFailure('PROVIDER_REQUEST_REJECTED', 403, 'authorization-error', providerReason) });
    const error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
    assert.equal(error.providerError, 'authorization-error'); assert.equal(error.providerReason, providerReason);
  }
  const h = harness({ getError: new ProviderFailure('PROVIDER_REQUEST_REJECTED', 403,
    'PRIVATE_PROVIDER_TOKEN', 'PRIVATE_REASON_TOKEN') });
  const error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
  assert.equal(error.providerError, 'unclassified'); assert.equal(error.providerReason, 'unclassified');
  assert.equal(JSON.stringify(error).includes('PRIVATE_'), false);
});

test('HLS configuration failure still deletes the isolated room', async () => {
  const h = harness({ rejectPost: 2 }), error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
  assert.equal(error.receipt.configuration_matches, false); assert.equal(error.receipt.cleanup_confirmed, true);
  assert.deepEqual(h.cleanups, [roomPath]); assert.equal(h.calls.length, 4);
});

test('readback must confirm private room, expiry and exact AWS/HLS settings', async () => {
  const changes = [room => { room.privacy = 'public'; }, room => { room.config.exp++; },
    room => { room.config.recordings_bucket.allow_api_access = true; },
    room => { room.config.recordings_bucket.bucket_name = 'another-bucket'; },
    room => { room.config.streaming_endpoints[0].hls_config.storage.path_template = 'elsewhere/{instance_id}'; },
    room => { room.config.streaming_endpoints[0].hls_config.variants[0].bitrate = 9000; },
    room => { room.config.streaming_endpoints.push({ type: 'rtmp', name: 'unrelated' }); }];
  for (const change of changes) {
    const h = harness({ readRoom: room => { change(room); return room; } }), error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
    assert.equal(error.receipt.configuration_matches, false); assert.equal(error.receipt.cleanup_confirmed, true);
    assert.deepEqual(h.cleanups, [roomPath]);
  }
});

test('an unexpectedly public create response is cleaned up before storage changes', async () => {
  const h = harness({ afterCreate: room => { room.privacy = 'public'; } }), error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
  assert.equal(h.calls.length, 2); assert.deepEqual(h.cleanups, [roomPath]);
  assert.equal(error.receipt.cleanup_confirmed, true);
});

test('a failed create response is reconciled by generated name and expiry before cleanup', async () => {
  const h = harness({ createAmbiguous: true }), error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
  assert.equal(h.calls.length, 3); assert.deepEqual(h.cleanups, [roomPath]);
  assert.equal(error.receipt.cleanup_confirmed, true); assert.equal(error.providerStatus, 503);
});

test('ambiguous creation cannot delete a room with a different expiry', async () => {
  const h = harness({ createAmbiguous: true, afterCreate: room => { room.config.exp--; } });
  const error = await fails(h, 'STORAGE_CLEANUP_UNCONFIRMED');
  assert.equal(h.calls.length, 3); assert.equal(h.cleanups.length, 0);
  assert.equal(error.receipt.cleanup_confirmed, false); assert.equal(error.receipt.mutation_attempted, true);
});

test('cleanup succeeds independently after the main provider deadline fails', async () => {
  const h = harness({ readRoom: () => { throw new ProviderFailure('PROVIDER_TIMEOUT'); } });
  const error = await fails(h, 'STORAGE_VERIFICATION_FAILED');
  assert.deepEqual(h.cleanups, [roomPath]); assert.equal(error.receipt.cleanup_confirmed, true);
});

test('cleanup must acknowledge deletion of the exact generated room before reporting success', async () => {
  for (const cleanupResult of [{ deleted: false, name: roomName }, { deleted: true, name: 'someone-else' }, null, {}]) {
    const h = harness({ cleanupResult }), error = await fails(h, 'STORAGE_CLEANUP_UNCONFIRMED');
    assert.equal(error.receipt.configuration_matches, true); assert.equal(error.receipt.cleanup_confirmed, false);
    assert.deepEqual(h.cleanups, [roomPath]);
  }
});

test('cleanup network failures remain explicit and all provider details stay redacted', async () => {
  const h = harness({ cleanupError: new ProviderFailure('PROVIDER_REQUEST_REJECTED', 503, 'PRIVATE_SECRET_ABC') });
  const error = await fails(h, 'STORAGE_CLEANUP_UNCONFIRMED');
  assert.equal(error.receipt.configuration_matches, true); assert.equal(error.receipt.cleanup_confirmed, false);
  assert.equal(error.providerStatus, 503); assert.equal(error.providerError, 'unclassified');
  assert.equal(JSON.stringify(error).includes('PRIVATE_SECRET_ABC'), false);
});
