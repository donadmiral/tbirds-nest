#!/usr/bin/env node
// Build an offline, reviewable deployment manifest. This script never connects
// to Supabase, installs migrations, provisions secrets or changes readiness.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const destination = 'docs/quality/music-operations-20261030/candidate.json';
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Usage: node scripts/quality/build-music-candidate.mjs [--check]');
const checkOnly = args.includes('--check');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = absolute => path.relative(root, absolute).split(path.sep).join('/');
function localFile(name, from = root) {
  const absolute = path.resolve(from, name);
  if (!absolute.startsWith(root + path.sep)) throw new Error(`File escapes repository: ${name}`);
  const actual = fs.realpathSync(absolute);
  if (!actual.startsWith(root + path.sep) || !fs.statSync(actual).isFile()) throw new Error(`Unsafe or missing file: ${name}`);
  return relative(absolute);
}
const read = name => fs.readFileSync(path.join(root, localFile(name)), 'utf8');
function file(name) {
  const canonical = localFile(name);
  const bytes = fs.readFileSync(path.join(root, canonical));
  return {path: canonical, sha256: sha(bytes), bytes: bytes.length};
}

// Only the simple scalar function settings used by this repository are parsed.
// An unsupported deployment setting fails closed instead of losing a file.
function functionSettings(name) {
  let section = '', settings = {};
  for (const raw of read('supabase/config.toml').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { section = header[1]; continue; }
    if (section !== `functions.${name}` && section !== `functions."${name}"`) continue;
    const pair = /^([a-z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!pair) throw new Error(`Unsupported function configuration for ${name}: ${line}`);
    const [, key, value] = pair;
    if (!['enabled', 'verify_jwt', 'entrypoint', 'import_map'].includes(key)) throw new Error(`Review ${name}.${key} before bundling`);
    if (key === 'enabled' || key === 'verify_jwt') {
      if (!/^(true|false)(\s*#.*)?$/.test(value)) throw new Error(`Invalid boolean ${name}.${key}`);
      settings[key] = value.startsWith('true');
    } else {
      const string = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(value);
      if (!string) throw new Error(`Invalid path ${name}.${key}`);
      settings[key] = JSON.parse(string[1]);
    }
  }
  return settings;
}

function bundle(name, purpose) {
  const settings = functionSettings(name);
  if (settings.enabled === false) throw new Error(`Required function ${name} is disabled in config`);
  const entrypoint = localFile(settings.entrypoint || `./functions/${name}/index.ts`, path.join(root, 'supabase'));
  const configPaths = new Set();
  if (settings.import_map) configPaths.add(localFile(settings.import_map, path.join(root, 'supabase')));
  for (const configName of ['deno.json', 'deno.jsonc']) {
    const configPath = `supabase/functions/${name}/${configName}`;
    if (fs.existsSync(path.join(root, configPath))) configPaths.add(localFile(configPath));
  }
  const maps = [];
  for (const configPath of configPaths) {
    const result = ts.parseConfigFileTextToJson(configPath, read(configPath));
    if (result.error) throw new Error(`Invalid JSON/JSONC ${configPath}`);
    const config = result.config;
    if (config.extends || config.importMap || Object.keys(config.scopes || {}).length) throw new Error(`Review inherited/scoped imports in ${configPath}`);
    maps.push({path: configPath, imports: config.imports || {}});
  }
  const visited = new Set(), external = new Set();
  function resolve(specifier, importer) {
    let value = specifier, base = path.dirname(path.join(root, importer));
    for (const map of maps) {
      const alias = Object.keys(map.imports).sort((a, b) => b.length - a.length).find(key => key === value || (key.endsWith('/') && value.startsWith(key)));
      if (alias) {
        const target = map.imports[alias];
        if (typeof target !== 'string') throw new Error(`Invalid import mapping in ${map.path}`);
        value = target + value.slice(alias.length);
        base = path.dirname(path.join(root, map.path));
        break;
      }
    }
    if (/^(node:|npm:|jsr:|https?:\/\/)/.test(value)) { external.add(value); return; }
    if (!value.startsWith('./') && !value.startsWith('../')) throw new Error(`Unresolved import ${specifier} in ${importer}`);
    visit(localFile(value, base));
  }
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    if (!/\.[cm]?[jt]sx?$/.test(name)) return;
    const source = ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length) throw new Error(`Cannot parse ${name}`);
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (!ts.isStringLiteralLike(node.moduleSpecifier)) throw new Error(`Nonliteral import in ${name}`);
        resolve(node.moduleSpecifier.text, name);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const value = node.moduleReference.expression;
        if (!value || !ts.isStringLiteralLike(value)) throw new Error(`Nonliteral require import in ${name}`);
        resolve(value.text, name);
      } else if (ts.isImportTypeNode(node)) {
        if (!ts.isLiteralTypeNode(node.argument) || !ts.isStringLiteralLike(node.argument.literal)) throw new Error(`Nonliteral import type in ${name}`);
        resolve(node.argument.literal.text, name);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        if (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0])) throw new Error(`Dynamic import must be reviewed explicitly in ${name}`);
        resolve(node.arguments[0].text, name);
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.[1]?.getText(source) === 'import.meta.url') {
        if (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0])) throw new Error(`Dynamic bundled asset in ${name}`);
        resolve(node.arguments[0].text, name);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
    for (const reference of source.referencedFiles) resolve(reference.fileName.startsWith('.') ? reference.fileName : `./${reference.fileName}`, name);
  }
  visit(entrypoint);
  const files = [...new Set([...visited, ...configPaths])].sort().map(file);
  return {
    name, purpose, entrypointPath: entrypoint,
    verifyJwt: settings.verify_jwt ?? true,
    verifyJwtSource: settings.verify_jwt === undefined ? 'Supabase default; send this value explicitly during deployment' : 'supabase/config.toml',
    ...(settings.import_map ? {importMapPath: localFile(settings.import_map, path.join(root, 'supabase'))} : {}),
    ...(maps.length ? {importMaps: maps} : {}),
    files, externalImports: [...external].sort(),
  };
}

const businessFunctions = ['business-signin', 'business-owner-access', 'daily-get-token', 'crisp-bridge', 'link-preview', 'apple-music', 'replicate-proxy', 'create-business'];
const audioFunctions = ['music-asset-finalize', 'content-media-sign', 'media-content', 'account-storage-erasure'];
const newFunctions = ['music-maintenance', 'music-catalogue-ingest'];
const affectedEdgeBundles = [
  ...businessFunctions.map(name => bundle(name, 'Business-session enforcement; deploy after verified business Auth migration')),
  ...audioFunctions.map(name => bundle(name, 'Original audio, private byte delivery or account erasure; deploy before upload readiness')),
  ...newFunctions.map(name => bundle(name, 'Music operations; requires both new migrations and explicit scoped caller authentication')),
];
const mediaPrerequisiteBundles = ['limited-media-file', 'chat-media-sign'].map(name => bundle(name, 'Existing bounded private-media prerequisite; verify target deployment, use its separate rollout if absent'));
const migration = (stem, note) => ({...file(`supabase/migrations/${stem}.sql`), sourceVersion: stem.slice(0, 14), migrationName: stem.slice(15), ...(note ? {note} : {})});
const pending = [
  migration('20261030034752_business_bound_auth_sessions', 'Fresh exact six-function/hash/ACL, hook, session and transaction preflight required.'),
  migration('20261030153811_original_music_library_and_delivery', 'Includes missing historical rights primitives only when absent; do not separately replay those historical music files.'),
  migration('20261030181000_market_offer_response_serialization', 'Independent wider-app acceptance gate, included in the tested combined chain; not an audio prerequisite.'),
  migration('20261030203619_music_catalogue_operations_and_cleanup'),
  migration('20261030204339_licensed_catalogue_pipeline'),
];
const commonPrerequisites = [
  '20261030000331_link_preview_verified_cache', '20261030005241_account_erasure_operator_review',
  '20261030010250_account_erasure_admin_restore_guard', '20261030012831_staff_social_shells',
  '20261030024125_studio_editorial_and_partnership_workflows', '20261030031124_reserve_web_route_usernames',
  '20261030033214_reserve_business_provision_usernames',
];
const qaPrerequisites = [
  file('supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql'),
  file('supabase/ops/qa/20261029233915_qa_media_completion_forward.sql'),
  migration('20261029224812_account_storage_erasure'),
  migration('20261029231321_account_erasure_admin_review_queue'),
  file('supabase/ops/qa/20261029235400_qa_database_access_hardening_forward.sql'),
  ...commonPrerequisites.map(stem => migration(stem)),
];
const productionPrerequisites = [
  '20261029224550_admin_operations_completion', '20261029224812_account_storage_erasure',
  '20261029224813_private_media_cutover_compatibility', '20261029231321_account_erasure_admin_review_queue',
  '20261029231440_bounded_media_delivery', '20261029234214_database_access_hardening',
  ...commonPrerequisites,
].map(stem => migration(stem));
const opsPaths = [
  'check-business-bound-auth-preflight', 'check-business-bound-auth-postflight', 'check-music-operations-postflight',
  'setup-music-maintenance-credential', 'install-music-maintenance-cron',
  'check-media-completion-postflight', 'check-account-erasure-health',
  'setup-account-erasure-credential', 'install-account-erasure-cron',
  'check-erasure-operator-preflight', 'check-erasure-operator-postflight', 'check-erasure-restore-preflight', 'check-erasure-restore-postflight',
  'check-admin-completion-preflight', 'check-admin-completion-postflight', 'check-qa-admin-completion-preflight',
  'check-qa-media-completion-preflight', 'check-database-hardening-preflight', 'check-database-hardening-postflight', 'check-qa-database-hardening-preflight',
  'check-link-preview-preflight', 'check-link-preview-postflight', 'check-staff-social-shells-preflight', 'check-staff-social-shells-postflight',
  'check-studio-workflows-preflight', 'check-studio-workflows-postflight', 'check-reserved-business-provision', 'check-reserved-web-usernames',
].map(name => file(`supabase/ops/${name}.sql`));
const tests = [
  {path: 'supabase/tests/rpc-authorization/test-business-music-integration.mjs', commands: ['node supabase/tests/rpc-authorization/test-business-music-integration.mjs', 'PLATINUM_QA_BUSINESS_AUTH=1 node supabase/tests/rpc-authorization/test-business-music-integration.mjs']},
  {path: 'supabase/tests/rpc-authorization/test-original-music-library.mjs', commands: ['MUSIC_PIPELINE_FIXTURE=1 node supabase/tests/rpc-authorization/test-original-music-library.mjs']},
  ...['test-music-operations', 'test-licensed-catalogue'].map(name => ({path: `supabase/tests/rpc-authorization/${name}.mjs`, commands: [`node supabase/tests/rpc-authorization/${name}.mjs`]})),
  ...['catalogue-ingestion', 'music-maintenance'].map(name => ({path: `tests/quality/${name}.cjs`, commands: [`node tests/quality/${name}.cjs`]})),
  {path: 'admin-web/tests/music-operations.cjs', commands: ['node admin-web/tests/music-operations.cjs']},
].map(({path, commands}) => ({...file(path), commands}));

const installationEvidence = 'docs/quality/backend-acceptance-20261030/continuation-installation-attempt.json';
const observation = JSON.parse(read(installationEvidence));
const generatedAt = new Date().toISOString();
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const manifest = {
  formatVersion: 1, generatedAt, sourceHeadAtGeneration: sourceHead,
  scope: 'Complete local file manifest and ordered handoff; not hosted installation or commercial activation evidence.',
  builder: file('scripts/quality/build-music-candidate.mjs'),
  checkCommand: 'node scripts/quality/build-music-candidate.mjs --check',
  projects: {qa: 'uaulhuelcfkjwojtymmw', production: 'prlkikhckbifseosbukl'},
  observedQaState: {evidence: file(installationEvidence), observedAt: observation.postflight.observedAt, businessSchemaAbsent: observation.postflight.businessSchemaAbsent, musicSchemaAbsent: observation.postflight.musicSchemaAbsent, dependentEdgeDeploymentsStarted: observation.postflight.dependentEdgeDeploymentsStarted},
  hostedStatus: 'Apply connector stalled; schemas absent at recorded postflight. No dependent Edge rollout or readiness activation. Recheck actual state before resuming.',
  productionStatus: 'Held. This is not an authorization to skip production prerequisites, client compatibility, exact target preflights or separate postflight.',
  functionConfiguration: file('supabase/config.toml'),
  functionConfigurationDocumentation: 'https://supabase.com/docs/guides/functions/function-configuration',
  functionConfigurationDocumentationVerified: '2026-10-30; current official documentation confirms JWT verification defaults on and entrypoint/import-map paths are relative to config.toml.',
  bundleRules: [
    'Preserve every repository-relative path in each bundle. For the deployment tool use each path as files[].name and its exact contents as files[].content.',
    'Use entrypointPath and, where present, importMapPath exactly. Send the recorded verifyJwt value explicitly.',
    'The recursive TypeScript parser includes imports, re-exports, type imports, static dynamic imports and literal import.meta.url assets; unresolved or dynamic module paths fail the builder.',
    'externalImports are runtime/bundler dependencies, not vendored files; actual hosted build/readback still needs verification. The unused daily-get-token Deno import-map alias is preserved.',
    'verifyJwt=false handlers authenticate the current Auth user/session, signed capability or scoped worker/provider credential in code. Never replace these checks with anonymous access.',
    'After deployment retrieve function metadata/source and compare file hashes, settings and active version; a submitted deployment alone is not acceptance.',
  ],
  qaExistingPrerequisiteOrder: qaPrerequisites,
  qaPrerequisiteInterpretation: 'Historical target-specific forward order, already recorded installed. Verify current contracts; do not replay these files. The QA media forward contains compatibility and bounded delivery and must not be followed by those production files again.',
  productionPrerequisiteOrder: productionPrerequisites,
  productionPrerequisiteInterpretation: 'Relative order after the inspected existing production baseline and installed narrow support/review restoration. Each exact target preflight is required. Do not bulk db-push repository history, apply QA adapters to production, or use source fixtures as live-state evidence.',
  pendingQaMigrationOrder: pending,
  musicOnlyMigrationOrder: pending.filter(item => !item.migrationName.startsWith('market_offer_')).map(item => item.path),
  migrationRules: [
    'Apply reviewed SQL through the supported migration transport once and record its returned migration identity. SourceVersion is the filename identity, not a claim about the version allocated by a hosted connector.',
    'Compare fresh preflight and postflight definitions, ACLs, bucket state, history and preserved row counts. Abort on exact-state drift; do not weaken guards or reset the project.',
    'Capture business-auth postflight immediately after that migration; later music migrations intentionally wrap the media resolver. Use the combined chain checks for the final composition.',
    'If a connector stalls, independently inspect schema/history/transactions. A timeout is not success; do not repeat indefinite waits or route DDL through an execute_sql operation that forbids it.',
  ],
  affectedEdgeBundles, existingMediaPrerequisiteBundles: mediaPrerequisiteBundles,
  deployGroupsInOrder: [businessFunctions, audioFunctions, newFunctions],
  operations: opsPaths,
  readiness: {
    expectedInitialState: {originalUploads: false, maintenance: false, catalogueIngestion: false, cataloguePlayback: false, providerCredentials: 0, signedCatalogueGrants: 0},
    initialStateMeaning: 'Migration/test expectation. Read actual values from the target; this is not an installed-state observation.',
    originalUploads: {state: 'music_library.service_state.uploads_enabled', operatorRpc: 'public.set_original_audio_service_ready(boolean,text)', steps: ['Verify finalizer/signer/proxy/erasure bundles and all migrations.', 'Enable only in disposable QA for the real upload/finalize/preview/story-post-book/audience/revoke/erase journey.', 'Record complete hosted acceptance before separate production readiness; disable on failure.']},
    maintenance: {state: 'music_library.maintenance_worker.enabled', operatorRpc: 'public.set_music_maintenance_ready(boolean,text)', steps: ['Deploy the worker only after both operations and catalogue migrations; it services both queues.', 'Run setup-music-maintenance-credential.sql; the scoped secret remains in Vault as music_maintenance_worker_secret.', 'Store the exact project URL in Vault as music_maintenance_project_url; verify it targets this project.', 'Verify exact deployed source and expected authentication rejection while disabled, then enable maintenance through its service-only RPC in QA.', 'Invoke using the scoped credential and verify response plus heartbeat; validation intentionally does not update heartbeat while disabled.', 'Install install-music-maintenance-cron.sql and inspect cron plus HTTP outcomes and worker heartbeat.', 'Run actual disposable abandoned-upload Storage cleanup before production readiness; quota releases only after verified object absence.']},
    catalogue: {states: ['music_library.catalogue_service.ingestion_enabled', 'music_library.catalogue_service.playback_enabled'], activationProvided: false, steps: ['Keep both switches off; this handoff provisions no commercial credentials, agreements or licensed-provider state.', 'After real licensing review, use separately reviewed signed-grant/provider/territory setup and acceptance based on actual provider requirements.', 'Staging metadata does not authorize ingestion, playback, reuse or export.']},
    immediatePause: ['set_original_audio_service_ready(false, reason)', 'set_music_maintenance_ready(false, reason)'],
    rollback: 'Pause the appropriate readiness gate. Preserve grants, tombstones, erasure state and migration history; use a separately reviewed forward repair for schema changes.',
  },
  acceptanceStillRequired: [
    'Actual hosted migrations, recursive Edge bundle deployment/readback and real Auth/Storage user and business-role journeys.',
    'Installed-client private-delivery compatibility, revoked/expired/range requests, warmed CDN/browser caches and disposable-account Storage/CDN/Auth erasure.',
    'Hosted Storage metadata-trigger compatibility, concurrent reservation/finalize/cleanup fencing and provider-level orphan byte cleanup.',
    'Actual licensed-provider credential/rights/territory/revocation/export/reporting acceptance after licensing; operation counts are not royalty statements.',
    'Physical iPhone/Android permissions, interruption/background behavior, camera/Photos export and media routes remain separate.',
  ],
  tests,
  integrationFixture: file('supabase/tests/rpc-authorization/business-auth-fixture.mjs'),
  persistentDatabaseRunner: file('supabase/tests/rpc-authorization/run-all.mjs'),
  references: [
    'docs/quality/music-operations-20261030/README.md', 'docs/quality/music-operations-20261030/verification.json',
    'docs/quality/backend-acceptance-20261030/music-pipeline-independent-review.json',
    'docs/quality/music-infrastructure-20261030/backend-candidate.json',
    'docs/quality/studio-workflows-20261030/business-auth-candidate.json',
    'docs/quality/MEDIA_PRIVACY_ERASURE_COMPLETION_20261029.md', 'docs/quality/ERASURE_OPERATOR_WORKFLOW_20261030.md',
    'docs/quality/ADMIN_COMPLETION_20261029.md', 'docs/quality/DATABASE_HARDENING_20261029.md',
    'docs/quality/backend-acceptance-20261030/final-backend-coverage.json',
  ],
};

if (checkOnly) {
  const recorded = JSON.parse(read(destination));
  // A later documentation commit does not change reviewed source hashes.
  manifest.generatedAt = recorded.generatedAt;
  manifest.sourceHeadAtGeneration = recorded.sourceHeadAtGeneration;
  if (JSON.stringify(manifest) !== JSON.stringify(recorded)) throw new Error('Candidate differs from current files/config/import graph. Review changes and regenerate the candidate.');
} else {
  fs.mkdirSync(path.dirname(path.join(root, destination)), {recursive: true});
  fs.writeFileSync(path.join(root, destination), JSON.stringify(manifest, null, 2) + '\n');
}
console.log(JSON.stringify({result: checkOnly ? 'verified' : 'written', candidate: destination, pendingMigrations: pending.length, affectedEdgeBundles: affectedEdgeBundles.length, prerequisiteEdgeBundles: mediaPrerequisiteBundles.length, uniqueBundledFiles: new Set([...affectedEdgeBundles, ...mediaPrerequisiteBundles].flatMap(item => item.files.map(file => file.path))).size}));
