import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const PINNED = Object.freeze({
  repository: 'donadmiral/tbirds-nest',
  source: '0338d70165c2b8d539b3508c8ae81910713da3f2',
  runId: 41887566674,
  jobId: 126776030623,
  // Real connected acceptance completed with 42 checks and successful cleanup.
  artifactId: 13351858151,
  archiveSha256: 'faa33f6acfdcf91673cba7723cf3dec96a649816ae6662195d93ff096b72041b',
  receiptSha256: 'a78126e21df2cf040b3b127b8f08a7db46290adcc835ac255ac4ee681c1d958e',
});
export const ALLOWED = Object.freeze([
  '.github/workflows/live-release-acceptance.yml',
  'supabase/tests/live-command-ack.test.cjs',
  'tests/quality/live-connected-evidence-reuse.cjs',
  'tools/reuse-live-connected-evidence.mjs',
].sort());
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// This second exception is one reviewed child of the original fixture correction.
// Only these frozen native/fixture bytes may differ. The two verifier sources
// are reviewed with the final commit, rather than attempting a self-referential hash.
export const NATIVE_CORRECTION = Object.freeze({
  parent: 'b2caf9720ab0cf67fe4a92a9bd58671111554af2',
  parentTree: '8f40aee066660eff70d51fad0cd1cf36a0e55001',
  files: Object.freeze([
    ['src/screens/feed/LiveSessionScreen.tsx', '406466a26153d194f23599b4e34c97393895267b29e1bc2a1603e879e8c1d1d6'],
    ['tests/live-immersive-native.test.cjs', 'e74dcfdf24d125a4784226e62bdc1daf26d7db329aaea95f7fcb78dc84ff6c20'],
    ['tests/native/backend-fixture.cjs', '7c3de14dc42c16d81f2cc14dd9458c143ba46efaced88c27badad62f27a4576c'],
    ['tests/native/flows/live-immersive.yaml', '2dc6b5838d3ac00a5627ce73599c9bce6cb04fd7f776e637009371c2fadc081e'],
    ['tests/quality/native-live-immersive.cjs', '21fc70b101115dd4677923257db3bab8c7d14c2f6b8b77e722574ad25078f2cf'],
    ['supabase/tests/live-command-ack.test.cjs', 'afbdd56b1196a53ca851d2aeed1c8f3d8efb5a3dbd7461ca51d4174bc06da5f2'],
    ['.github/workflows/live-release-acceptance.yml', 'd130395ddaf55df8ae3667379bb56b79eb0f0ed48053b24dbfba3d8974bf0705'],
  ].map(([file, sha256]) => Object.freeze({path: file, sha256, mode: '100644'}))),
});
export const FEED_CORRECTION = Object.freeze({
  parent: '7f7e9e3909957befc4e9e3e45e8594db51a58aaf',
  parentTree: 'b33ad22a1d6c4e26f96696e5e1fa8711cc043611',
  files: Object.freeze([
    [".github/workflows/native-feed-android-validation.yml", "0f505ba17bc9ff95f86df05bee147d66741fa7438cc9acd1d00938ef4733af64"],
    [".github/workflows/live-release-acceptance.yml", "7d142e33caf61ec59fb4ebed2170389800e2d7417b06209528a5f75bdaab45f2"],
    ["scripts/quality/native-ui-android-root.py", "9ffe57e704de84c365435779f150fcdf9f3e067d1a38e9d5761df7d0320d1b54"],
    ["scripts/quality/prepare-native-ui.cjs", "111fde011a03aaae0c7056632fed6a291e5184b146ae01de2300fb1585f74df6"],
    ["scripts/quality/test-android-app-ui.sh", "72fce6aa4c3372ad4f08c7aaf216e538aa356da115e16775c0ea2da8d7fadde3"],
    ["src/screens/feed/FeedScreen.tsx", "5b5a60cf37268ba4e5ce0ef929a5ce75a71183a4875332738568c448bcf052cd"],
    ["tests/feed-capacity.test.cjs", "798a12539685bde634fef324cdd54966c9354e3c997160252a5bc2a59a05e2ff"],
    ["tests/quality/native-android-root.cjs", "2107ee3456c93922f21e41c5a6d77c4f854e58e21766c92fa560bf4261061178"],
    ["tests/quality/native-android-stack-diagnostics.cjs", "19de4fcd741308f2b06728f1469ca3ee4206c37f6a789d19d513d6398c334eec"],
    ["tests/quality/native-auth-diagnostics.cjs", "0f5a44c30a20c6d4247766e3324ab8dff181df22852a6555b210554dd8ef5ef3"],
    ["tests/quality/native-feed-video.cjs", "5ff62248e08b31683da56de50fbf61693a243af594726da47a3e333b86668a86"],
    ["tests/quality/native-xvfb-readiness.cjs", "8e0b664ac2c5ba3c6efc06c9cd409bb7b9e7cbc00a5ced7305e97148863a6d31"],
  ].map(([file, sha256]) => Object.freeze({path: file, sha256, mode: '100644'}))),
});
// One reviewed native keyboard and login-flow correction may reuse service evidence.
// Its parent already contains the feed correction. Neither native change is
// covered by the original browser/provider receipt, so native acceptance is fresh.
export const KEYBOARD_CORRECTION = Object.freeze({
  parent: '0810ea8a30cd3818878b60fccea0689a453a3b19',
  parentTree: '21d94004927cd8c3284fb9fc42dd3bcc3db3725f',
  files: Object.freeze([
    ['src/screens/feed/LiveSessionScreen.tsx', 'cbda26bd34cfa428c9a6132de60d5799305a4d478a84c7deacce22b65a5d3afa'],
    ['src/components/LiveStudio.tsx', '371fdf5cd0bff7849b010766d49aacf6cdec899e76d0dd6a9ec66c96c86683ae'],
    ['src/components/LiveChat.tsx', 'b4cb874e3dae1f23f8fe0189f495b30859e61787baa0920d45a2e45502b0e59a'],
    ['tests/live-immersive-native.test.cjs', '42e30a3c0822f3b229b8c77acd3b67ef5ce9b39fddffb868ffc332d29e730c4e'],
    ['tests/live-studio-auto-scene.test.cjs', 'da18eaf13a1c7f8ad184158661d0a9f83cb8ead8ec0915ea66be178564a905de'],
    ['tests/live-native-chat-lifecycle.test.cjs', '7081c2c09fbcb40d942299ced5446d1d2ed79ef8be854285277a9643d409512a'],
    ['tests/live-chat-access.test.cjs', 'd6fcb70a05ffb058237c24c30c8d6876caf4b02d9d8ef9863479e00806292879'],
    ['tests/native/flows/navigation.yaml', '75d690bac6c858eaf45c52821c98b283ac887ce27a1a2ff30ee429e860a10932'],
    ['tests/quality/native-login-readiness.cjs', '8a82ebd5522138d00e95227d036781873b9e3e35dc5132a9ae7a900f8ddb6a68'],
    ['.github/workflows/live-release-acceptance.yml', '2640f2aa4da4e7f36e58911de120edd0ddb64534f700b87eb4341dafd96f7317'],
  ].map(([file, sha256]) => Object.freeze({path: file, sha256, mode: '100644'}))),
});
// One reviewed child prepares only the disposable iPhone Simulator's AutoFill UI.
// Original service evidence remains on0338. Both native platforms still need
// exact-source acceptance, including the earlier feed and keyboard corrections.
export const AUTOFILL_CORRECTION = Object.freeze({
  parent: 'bb6797cfae67eb1142236615dee3daaac3e1b771',
  parentTree: '75c7587093bb8c4d37ae45811e60b9d8e73af873',
  acceptedTree: '56809768fb0e6e13a11afcc6f2096de6139c88ae',
  files: Object.freeze([
    ['scripts/quality/native-ui-ios-autofill.py', '122d13cf99c125c05cf8ad1bf71907886a9b3b706348cb41eee610b2b0df4435'],
    ['tests/native/flows/ios-autofill-open.yaml', '2c32dd907e5a9dd4deb1b0d7c3bf8ce8170652160f6127912997263da2d5ae6b'],
    ['tests/native/flows/ios-autofill-disable.yaml', '1f18dcb568a6c7fe6c649a86f81f725c0d4c9a0801ec6c84eb503b01036e1ee1'],
    ['tests/quality/native-ios-autofill.cjs', '70c3d631e36e46ec7fe86d64bc9d3115248d3e82b022a3be1e413435bd7c6ee0'],
    ['scripts/quality/test-ios-app-ui.sh', '9c0f9c1c490ef008dfd36fda8122acc3f7f1fcf2eba9e2bc8e8b7b5a2619ca54'],
    ['scripts/quality/prepare-native-ui.cjs', '8e8ad49ecd238c81cb3cb299b9311451e4ca62ebe9ed61eae34afd83942862e6'],
    ['tests/quality/native-auth-diagnostics.cjs', 'ac2ec665dd6ab6c4cf7f77829fbae9e8620f20295e69584be15a4e6baa40c6c9'],
    ['.github/workflows/live-release-acceptance.yml', '6bb39c7bcd6f278075b7111d2ebd2285529058058ed4882c35ef989e18954878'],
  ].map(([file, sha256]) => Object.freeze({path: file, sha256, mode: '100644'}))),
});
// One reviewed direct child changes only the original AutoFill setup budget.
// The creation-origin deadline remains single and bounded. App acceptance and
// the original0338 provider receipt remain separate and source-bound.
export const AUTOFILL_BUDGET_CORRECTION = Object.freeze({
  parent: '4b9f018832f9ce3e33b2db981849daf430912518',
  parentTree: '2677061c688414c6d710c7432c6d224f0626a631',
  acceptedTree: '56809768fb0e6e13a11afcc6f2096de6139c88ae',
  files: Object.freeze([
    ['scripts/quality/native-ui-ios-autofill.py', '20e279508af18b38bb4b19565b3f587df80990f50b326c1e3bec1b51e6541b44'],
    ['tests/quality/native-ios-autofill.cjs', 'dbf50f3374e9b9d8cd4eb40651406b76c9c1d0b642874374bc747d39832c319d'],
    ['.github/workflows/live-release-acceptance.yml', '257755af631b048d40aac1ada05a0c89c418b41a8a3083b7a9deff392b0f3997'],
  ].map(([file, sha256]) => Object.freeze({path: file, sha256, mode: '100644'}))),
});
export const VERIFIER_FILES = Object.freeze([
  'tests/quality/live-connected-evidence-reuse.cjs',
  'tools/reuse-live-connected-evidence.mjs',
]);
export const CONNECTED_PATHS = Object.freeze([
  'web', 'admin-web', 'shared', 'supabase/functions', 'supabase/migrations',
  'workers', 'infrastructure', 'scripts/quality', 'package.json', 'package-lock.json',
  'eas.json', 'tools/build-live-qa.mjs',
]);
function changedPaths(git, base, target) {
  return git(['diff', '--name-only', '--no-renames', base, target]).trim().split('\n').filter(Boolean).sort();
}
function normalFile(git, target, file, mode = '100644') {
  const rows = git(['ls-tree', '-z', target, '--', file]).split('\0').filter(Boolean);
  assert.equal(rows.length, 1, 'Reviewed file is missing');
  const [entry, name] = rows[0].split('\t');
  const [actualMode, type] = entry.split(' ');
  assert.equal(name, file); assert.equal(type, 'blob');
  assert.equal(actualMode, mode, 'Reviewed file mode changed');
}
function fixtureCorrection(git, base, target) {
  assert.deepEqual(changedPaths(git, base, target), ALLOWED, 'Runtime or unrelated source changed. Connected evidence cannot be reused');
  const status = git(['diff', '--name-status', '--no-renames', base, target]).trim().split('\n');
  assert.ok(status.every(line => /^[AM]\t/.test(line)), 'Reuse cannot delete or rename files');
  for (const file of ALLOWED) normalFile(git, target, file);
}
export function sourceApplicability(git, source, base = PINNED.source, nativeRule = NATIVE_CORRECTION, feedRule = FEED_CORRECTION, keyboardRule = KEYBOARD_CORRECTION, autofillRule = AUTOFILL_CORRECTION, budgetRule = AUTOFILL_BUDGET_CORRECTION) {
  assert.equal(git(['rev-parse', 'HEAD']).trim(), source, 'Checkout differs from release source');
  const parents = git(['show', '-s', '--format=%P', 'HEAD']).trim().split(/\s+/);
  if (parents.includes(budgetRule.parent)) {
    assert.deepEqual(parents, [budgetRule.parent], 'AutoFill budget reuse must be the reviewed single-parent correction');
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=no']).trim(), '', 'Tracked checkout or index differs from the verified source');
    for (const [rule, parent] of [[budgetRule, autofillRule.parent], [autofillRule, keyboardRule.parent], [keyboardRule, feedRule.parent], [feedRule, nativeRule.parent], [nativeRule, base]]) {
      assert.equal(git(['rev-parse', rule.parent + '^{tree}']).trim(), rule.parentTree, 'Reviewed AutoFill budget ancestry tree changed');
      assert.deepEqual(git(['show', '-s', '--format=%P', rule.parent]).trim().split(/\s+/), [parent], 'Reviewed AutoFill budget parent ancestry changed');
    }
    assert.equal(git(['rev-parse', base + '^{tree}']).trim(), budgetRule.acceptedTree, 'Original connected source tree changed');
    const allowed = [...budgetRule.files.map(file => file.path), ...VERIFIER_FILES].sort();
    assert.deepEqual(changedPaths(git, budgetRule.parent, 'HEAD'), allowed, 'AutoFill budget exception contains an unreviewed or missing change');
    const status = git(['diff', '--name-status', '--no-renames', budgetRule.parent, 'HEAD']).trim().split('\n');
    assert.ok(status.every(line => /^M\t/.test(line)), 'AutoFill budget exception cannot add, delete, rename or change file type');
    for (const file of allowed) normalFile(git, 'HEAD', file);
    for (const file of budgetRule.files) {
      normalFile(git, 'HEAD', file.path, file.mode);
      assert.equal(hash(git(['show', 'HEAD:' + file.path])), file.sha256, 'Reviewed AutoFill budget correction bytes changed: ' + file.path);
    }
    const connected = CONNECTED_PATHS.filter(file => file !== 'scripts/quality')
      .concat('scripts/quality/install-browser-test-runtime.sh');
    assert.equal(git(['diff', '--name-only', '--no-renames', base, 'HEAD', '--', ...connected]).trim(), '', 'Connected runtime or browser preparation changed');
    return {kind: 'native-ios-autofill-budget-correction', comparisonParent: budgetRule.parent,
      comparisonParentTree: budgetRule.parentTree, connectedRuntimeEquivalent: true,
      nativeRuntimeEquivalent: false, nativeFeedRequiresSeparateValidation: true,
      nativeKeyboardRequiresSeparateValidation: true, nativeIosAutofillRequiresSeparateValidation: true,
      permittedChanges: allowed, verifiedFiles: budgetRule.files};
  }
  if (parents.includes(autofillRule.parent)) {
    assert.deepEqual(parents, [autofillRule.parent], 'AutoFill reuse must be the reviewed single-parent correction');
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=no']).trim(), '', 'Tracked checkout or index differs from the verified source');
    for (const [rule, parent] of [[autofillRule, keyboardRule.parent], [keyboardRule, feedRule.parent], [feedRule, nativeRule.parent], [nativeRule, base]]) {
      assert.equal(git(['rev-parse', rule.parent + '^{tree}']).trim(), rule.parentTree, 'Reviewed AutoFill ancestry tree changed');
      assert.deepEqual(git(['show', '-s', '--format=%P', rule.parent]).trim().split(/\s+/), [parent], 'Reviewed AutoFill parent ancestry changed');
    }
    assert.equal(git(['rev-parse', base + '^{tree}']).trim(), autofillRule.acceptedTree, 'Original connected source tree changed');
    const allowed = [...autofillRule.files.map(file => file.path), ...VERIFIER_FILES].sort();
    assert.deepEqual(changedPaths(git, autofillRule.parent, 'HEAD'), allowed, 'AutoFill exception contains an unreviewed or missing change');
    const status = git(['diff', '--name-status', '--no-renames', autofillRule.parent, 'HEAD']).trim().split('\n');
    assert.ok(status.every(line => /^[AM]\t/.test(line)), 'AutoFill exception cannot delete, rename or change file type');
    for (const file of allowed) normalFile(git, 'HEAD', file);
    for (const file of autofillRule.files) {
      normalFile(git, 'HEAD', file.path, file.mode);
      assert.equal(hash(git(['show', 'HEAD:' + file.path])), file.sha256, 'Reviewed AutoFill correction bytes changed: ' + file.path);
    }
    const connected = CONNECTED_PATHS.filter(file => file !== 'scripts/quality')
      .concat('scripts/quality/install-browser-test-runtime.sh');
    assert.equal(git(['diff', '--name-only', '--no-renames', base, 'HEAD', '--', ...connected]).trim(), '', 'Connected runtime or browser preparation changed');
    return {kind: 'native-ios-autofill-preflight', comparisonParent: autofillRule.parent,
      comparisonParentTree: autofillRule.parentTree, connectedRuntimeEquivalent: true,
      nativeRuntimeEquivalent: false, nativeFeedRequiresSeparateValidation: true,
      nativeKeyboardRequiresSeparateValidation: true, nativeIosAutofillRequiresSeparateValidation: true,
      permittedChanges: allowed, verifiedFiles: autofillRule.files};
  }
  if (parents.includes(keyboardRule.parent)) {
    assert.deepEqual(parents, [keyboardRule.parent], 'Keyboard reuse must be the reviewed single-parent correction');
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=no']).trim(), '', 'Tracked checkout or index differs from the verified source');
    assert.equal(git(['rev-parse', keyboardRule.parent + '^{tree}']).trim(), keyboardRule.parentTree, 'Reviewed keyboard parent tree changed');
    assert.deepEqual(git(['show', '-s', '--format=%P', keyboardRule.parent]).trim().split(/\s+/), [feedRule.parent], 'Reviewed keyboard parent ancestry changed');
    const allowed = [...keyboardRule.files.map(file => file.path), ...VERIFIER_FILES].sort();
    assert.deepEqual(changedPaths(git, keyboardRule.parent, 'HEAD'), allowed, 'Keyboard exception contains an unreviewed or missing change');
    const status = git(['diff', '--name-status', '--no-renames', keyboardRule.parent, 'HEAD']).trim().split('\n');
    assert.ok(status.every(line => /^M\t/.test(line)), 'Keyboard exception cannot add, delete, rename or change file type');
    for (const file of allowed) normalFile(git, 'HEAD', file);
    for (const file of keyboardRule.files) {
      normalFile(git, 'HEAD', file.path, file.mode);
      assert.equal(hash(git(['show', 'HEAD:' + file.path])), file.sha256, 'Reviewed keyboard correction bytes changed: ' + file.path);
    }
    const connected = CONNECTED_PATHS.filter(file => file !== 'scripts/quality')
      .concat('scripts/quality/install-browser-test-runtime.sh');
    assert.equal(git(['diff', '--name-only', '--no-renames', base, 'HEAD', '--', ...connected]).trim(), '', 'Connected runtime or browser preparation changed');
    return {kind: 'native-live-keyboard-correction', comparisonParent: keyboardRule.parent,
      comparisonParentTree: keyboardRule.parentTree, connectedRuntimeEquivalent: true,
      nativeRuntimeEquivalent: false, nativeFeedRequiresSeparateValidation: true,
      nativeKeyboardRequiresSeparateValidation: true, permittedChanges: allowed,
      verifiedFiles: keyboardRule.files};
  }
  if (parents.includes(feedRule.parent)) {
    assert.deepEqual(parents, [feedRule.parent], 'Feed reuse must be the reviewed single-parent correction');
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=no']).trim(), '', 'Tracked checkout or index differs from the verified source');
    assert.equal(git(['rev-parse', feedRule.parent + '^{tree}']).trim(), feedRule.parentTree, 'Reviewed feed parent tree changed');
    assert.deepEqual(git(['show', '-s', '--format=%P', feedRule.parent]).trim().split(/\s+/), [nativeRule.parent], 'Reviewed feed parent ancestry changed');
    const allowed = [...feedRule.files.map(file => file.path), ...VERIFIER_FILES].sort();
    assert.deepEqual(changedPaths(git, feedRule.parent, 'HEAD'), allowed, 'Feed exception contains an unreviewed or missing change');
    const status = git(['diff', '--name-status', '--no-renames', feedRule.parent, 'HEAD']).trim().split('\n');
    assert.ok(status.every(line => /^[AM]\t/.test(line)), 'Feed exception cannot delete, rename or change file type');
    for (const file of allowed) normalFile(git, 'HEAD', file);
    for (const file of feedRule.files) {
      normalFile(git, 'HEAD', file.path, file.mode);
      assert.equal(hash(git(['show', 'HEAD:' + file.path])), file.sha256, 'Reviewed feed correction bytes changed: ' + file.path);
    }
    // Android-only preparation is separately hash-bound above. Connected web,
    // shared Live, backend/provider and browser preparation remain byte-identical.
    const connected = CONNECTED_PATHS.filter(file => file !== 'scripts/quality')
      .concat('scripts/quality/install-browser-test-runtime.sh');
    assert.equal(git(['diff', '--name-only', '--no-renames', base, 'HEAD', '--', ...connected]).trim(), '', 'Connected runtime or browser preparation changed');
    return {kind: 'native-feed-refresh-correction', comparisonParent: feedRule.parent,
      comparisonParentTree: feedRule.parentTree, connectedRuntimeEquivalent: true,
      nativeRuntimeEquivalent: false, nativeFeedRequiresSeparateValidation: true,
      permittedChanges: allowed, verifiedFiles: feedRule.files};
  }
  const native = parents.includes(nativeRule.parent);
  // Other normal releases retain real connected acceptance. A mismatch inside
  // an explicit exception throws, so it cannot fall through to provider work.
  if (!native && !parents.includes(base)) return null;
  assert.deepEqual(parents, [native ? nativeRule.parent : base], 'Reuse must be a reviewed single-parent correction');
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=no']).trim(), '', 'Tracked checkout or index differs from the verified source');
  if (!native) {
    fixtureCorrection(git, base, 'HEAD');
    return {kind: 'fixture-correction', comparisonParent: base, connectedRuntimeEquivalent: true,
      nativeRuntimeEquivalent: true, permittedChanges: ALLOWED, verifiedFiles: []};
  }
  assert.equal(git(['rev-parse', nativeRule.parent + '^{tree}']).trim(), nativeRule.parentTree, 'Reviewed parent tree changed');
  assert.deepEqual(git(['show', '-s', '--format=%P', nativeRule.parent]).trim().split(/\s+/), [base], 'Reviewed parent ancestry changed');
  fixtureCorrection(git, base, nativeRule.parent);
  const allowed = [...nativeRule.files.map(file => file.path), ...VERIFIER_FILES].sort();
  assert.deepEqual(changedPaths(git, nativeRule.parent, 'HEAD'), allowed, 'Native exception contains an unreviewed or missing change');
  const status = git(['diff', '--name-status', '--no-renames', nativeRule.parent, 'HEAD']).trim().split('\n');
  assert.ok(status.every(line => /^M\t/.test(line)), 'Native exception cannot add, delete, rename or change file type');
  for (const file of allowed) normalFile(git, 'HEAD', file);
  for (const file of nativeRule.files) {
    normalFile(git, 'HEAD', file.path, file.mode);
    assert.equal(hash(git(['show', 'HEAD:' + file.path])), file.sha256, 'Reviewed correction bytes changed: ' + file.path);
  }
  assert.equal(git(['diff', '--name-only', '--no-renames', base, 'HEAD', '--', ...CONNECTED_PATHS]).trim(), '', 'Connected runtime or preparation changed');
  return {kind: 'native-clips-correction', comparisonParent: nativeRule.parent, comparisonParentTree: nativeRule.parentTree,
    connectedRuntimeEquivalent: true, nativeRuntimeEquivalent: false, permittedChanges: allowed, verifiedFiles: nativeRule.files};
}
export function sourceEquivalent(git, source, base = PINNED.source, nativeRule = NATIVE_CORRECTION, feedRule = FEED_CORRECTION, keyboardRule = KEYBOARD_CORRECTION, autofillRule = AUTOFILL_CORRECTION, budgetRule = AUTOFILL_BUDGET_CORRECTION) {
  return sourceApplicability(git, source, base, nativeRule, feedRule, keyboardRule, autofillRule, budgetRule) !== null;
}

export function verifyMetadata(run, job, artifact, pinned = PINNED) {
  assert.equal(run.id, pinned.runId); assert.equal(run.head_sha, pinned.source);
  assert.equal(run.path, '.github/workflows/live-release-acceptance.yml'); assert.equal(run.event, 'push');
  assert.equal(run.head_repository?.full_name, pinned.repository);
  assert.equal(job.id, pinned.jobId); assert.equal(job.run_id, pinned.runId);
  assert.equal(job.name, 'connected-host-viewer');
  assert.equal(job.status, 'completed'); assert.equal(job.conclusion, 'success');
  assert.equal(artifact.id, pinned.artifactId); assert.equal(artifact.name, 'live-connected-acceptance');
  assert.equal(artifact.expired, false); assert.equal(artifact.workflow_run?.id, pinned.runId);
  assert.equal(artifact.workflow_run?.head_sha, pinned.source);
  assert.equal(artifact.digest, 'sha256:' + pinned.archiveSha256);
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 64 * 1024 * 1024);
}

export function verifyReceipt(receipt, pinned = PINNED) {
  assert.equal(receipt.source, pinned.source); assert.equal(receipt.failure, null);
  assert.deepEqual(receipt.errors, []); assert.equal(receipt.cleanup?.ok, true);
  assert.equal(receipt.cleanup?.cleaned_users, 3);
  assert.ok(Array.isArray(receipt.checks) && receipt.checks.length >= 37);
  for (const required of [
    'Guest request, cancellation, renewed request and host approval reached separate browsers without refreshing or starting a camera',
    'Joining the approved guest automatically published the host and guest interview scene without manual camera selection',
    'Real encoder completed the recorded clip and approved private output assets',
    'Feed post references authorized clip media and delivers real MP4 bytes to the follower',
  ]) assert.ok(receipt.checks.includes(required), 'Required connected behavior is absent');
  for (const stream of [1, 2]) assert.ok(receipt.players?.some(player => player.observation === 'decoded-portrait-hls'
    && player.stream === stream && player.width > 0 && player.height > player.width
    && Math.abs(player.width / player.height - 9 / 16) < .01 && player.readyState >= 2 && player.currentTime > 2), 'Portrait decoder evidence is absent');
  assert.ok(receipt.controls?.some(control => control.automatic === true && control.status === 200 && control.ok === true));
  for (const id of [receipt.clipId, receipt.postId]) assert.match(id || '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
}

export async function boundedBody(response, maximum) {
  assert.ok(response.body, 'Missing evidence response');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength; assert.ok(size <= maximum, 'Evidence exceeds its byte limit'); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function archiveReceipt(bytes, expectedDigest, includeIdentity = false) {
  assert.equal(hash(bytes), expectedDigest, 'Downloaded archive digest mismatch');
  const script = `import io,sys,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nitems=z.infolist()\nassert len(items)<=1000 and sum(i.file_size for i in items)<=128*1024*1024\nselected=[i for i in items if i.filename=='receipt.json']\nassert len(selected)==1 and 0<selected[0].file_size<=2*1024*1024\nsys.stdout.buffer.write(z.read(selected[0]))\n`;
  const receiptBytes = execFileSync('python3', ['-c', script], {input: bytes, maxBuffer: 2 * 1024 * 1024, timeout: 10000, stdio: ['pipe', 'pipe', 'ignore']});
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  return includeIdentity ? {receipt, receiptBytes, receiptSha256: hash(receiptBytes)} : receipt;
}
export async function fetchArchive(fetcher, prefix, headers, artifactId) {
  const redirect = await fetcher(prefix + `/actions/artifacts/${artifactId}/zip`, {headers, redirect: 'manual', signal: AbortSignal.timeout(15000)});
  assert.equal(redirect.status, 302, 'GitHub artifact download redirect missing');
  const location = new URL(redirect.headers.get('location'));
  assert.equal(location.protocol, 'https:'); assert.equal(location.username, ''); assert.equal(location.password, '');
  // The read token is sent only to api.github.com, never to artifact storage.
  const response = await fetcher(location.href, {redirect: 'error', signal: AbortSignal.timeout(60000)});
  assert.equal(response.status, 200, 'Prior evidence archive unavailable');
  return boundedBody(response, 64 * 1024 * 1024);
}
export async function reuseConnected({env = process.env, fetcher = fetch, git = args => execFileSync('git', args, {encoding: 'utf8', timeout: 15000})} = {}) {
  assert.equal(env.GITHUB_REPOSITORY, PINNED.repository); assert.match(env.GITHUB_SHA || '', /^[a-f0-9]{40}$/);
  const applicability = sourceApplicability(git, env.GITHUB_SHA);
  if (!applicability) return {reused: false};
  assert.ok(PINNED.artifactId > 0 && /^[a-f0-9]{64}$/.test(PINNED.archiveSha256) && !/^0+$/.test(PINNED.archiveSha256), 'Reviewed artifact is not pinned');
  assert.ok(env.GITHUB_TOKEN, 'CI read token required for evidence verification');
  const prefix = `https://api.github.com/repos/${PINNED.repository}`;
  const headers = {Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
  const get = async suffix => {
    const response = await fetcher(prefix + suffix, {headers, redirect: 'error', signal: AbortSignal.timeout(15000)});
    assert.equal(response.status, 200, 'GitHub evidence metadata unavailable');
    return JSON.parse((await boundedBody(response, 2 * 1024 * 1024)).toString('utf8'));
  };
  const [run, job, artifact] = await Promise.all([get(`/actions/runs/${PINNED.runId}`), get(`/actions/jobs/${PINNED.jobId}`), get(`/actions/artifacts/${PINNED.artifactId}`)]);
  verifyMetadata(run, job, artifact);
  const original = archiveReceipt(await fetchArchive(fetcher, prefix, headers, PINNED.artifactId), PINNED.archiveSha256, true);
  assert.equal(original.receiptSha256, PINNED.receiptSha256, 'Original connected receipt digest mismatch');
  const receipt = original.receipt;
  verifyReceipt(receipt);
  const evidence = env.LIVE_CONNECTED_EVIDENCE || '/tmp/live-connected-evidence';
  fs.mkdirSync(evidence, {recursive: true});
  fs.writeFileSync(path.join(evidence, 'source-receipt.json'), original.receiptBytes);
  const reuse = {reused: true, source: env.GITHUB_SHA, acceptedSource: PINNED.source, ...applicability,
    priorRunId: PINNED.runId, priorJobId: PINNED.jobId, priorArtifactId: PINNED.artifactId,
    archiveSha256: PINNED.archiveSha256, originalReceiptSha256: original.receiptSha256, checks: receipt.checks.length, newProviderRun: false,
    evidenceUrl: `https://github.com/${PINNED.repository}/actions/runs/${PINNED.runId}/artifacts/${PINNED.artifactId}`};
  fs.writeFileSync(path.join(evidence, 'reuse-receipt.json'), JSON.stringify(reuse, null, 2) + '\n');
  return reuse;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reuseConnected().then(result => {
    assert.ok(process.env.GITHUB_OUTPUT, 'Workflow output path required');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `reused=${result.reused}\n`);
    if (result.reused && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Reused verified connected acceptance from ${PINNED.source}. Connected runtime bytes are unchanged.${result.nativeRuntimeEquivalent ? '' : ' Native runtime changed and requires fresh native acceptance.'} ${result.evidenceUrl}\n`);
    console.log(JSON.stringify(result));
  }).catch(() => { console.error('Connected evidence verification failed. No reuse or new provider run is authorized.'); process.exitCode = 1; });
}
