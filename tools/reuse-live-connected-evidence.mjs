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
export function sourceApplicability(git, source, base = PINNED.source, nativeRule = NATIVE_CORRECTION) {
  assert.equal(git(['rev-parse', 'HEAD']).trim(), source, 'Checkout differs from release source');
  const parents = git(['show', '-s', '--format=%P', 'HEAD']).trim().split(/\s+/);
  const native = parents.includes(nativeRule.parent);
  // Other normal releases retain real connected acceptance. A mismatch inside
  // either explicit exception throws, so it cannot fall through to provider work.
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
export function sourceEquivalent(git, source, base = PINNED.source, nativeRule = NATIVE_CORRECTION) {
  return sourceApplicability(git, source, base, nativeRule) !== null;
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
