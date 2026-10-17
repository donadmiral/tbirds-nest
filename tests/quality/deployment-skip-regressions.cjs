const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const apps = ['web', 'admin-web'];
const commands = Object.fromEntries(apps.map((app) => [app,
  JSON.parse(fs.readFileSync(path.join(__dirname, '../..', app, 'vercel.json'), 'utf8')).ignoreCommand,
]));

function git(cwd, ...args) {
  const result = spawnSync('git', [
    '-c', 'user.name=Deployment Regression', '-c', 'user.email=deployment-test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
  ], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'platinum-deployment-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet');
  for (const dir of [...apps, 'supabase']) fs.mkdirSync(path.join(repo, dir));
  for (const app of apps) fs.writeFileSync(path.join(repo, app, 'index.js'), 'initial app\n');
  fs.writeFileSync(path.join(repo, 'supabase/migration.sql'), '-- initial schema\n');
  const commit = (message) => {
    git(repo, 'add', '.');
    git(repo, 'commit', '--quiet', '-m', message);
    return git(repo, 'rev-parse', 'HEAD');
  };
  const previous = commit('Last successful deployment');
  const change = (file) => fs.appendFileSync(path.join(repo, file), 'changed\n');
  return { root, repo, previous, commit, change };
}

function ignoredExit(repo, app, previous) {
  const env = { ...process.env };
  delete env.VERCEL_GIT_PREVIOUS_SHA;
  if (previous !== undefined) env.VERCEL_GIT_PREVIOUS_SHA = previous;
  const result = spawnSync('sh', ['-c', commands[app]], {
    cwd: path.join(repo, app), env, encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  return result.status;
}

for (const app of apps) {
  test(`${app}: unchanged app since the successful deployment is skipped`, (t) => {
    const f = fixture(t);
    f.change('supabase/migration.sql');
    f.commit('SQL only');
    assert.equal(ignoredExit(f.repo, app, f.previous), 0);
  });

  test(`${app}: changed app builds while an unrelated app can be skipped`, (t) => {
    const f = fixture(t);
    f.change(`${app}/index.js`);
    f.commit('Application change');
    assert.equal(ignoredExit(f.repo, app, f.previous), 1);
    assert.equal(ignoredExit(f.repo, apps.find((other) => other !== app), f.previous), 0);
  });

  test(`${app}: earlier application changes still build after a SQL-only final commit`, (t) => {
    const f = fixture(t);
    f.change(`${app}/index.js`);
    f.commit('Application change');
    f.change('supabase/migration.sql');
    f.commit('SQL only');
    const oldCommand = spawnSync('git', ['diff', '--quiet', 'HEAD^', 'HEAD', '--', '.'], {
      cwd: path.join(f.repo, app),
    });
    assert.equal(oldCommand.status, 0, 'The old HEAD^ comparison misses the application change');
    assert.equal(ignoredExit(f.repo, app, f.previous), 1);
  });

  test(`${app}: a new branch without a previous successful SHA builds`, (t) => {
    const f = fixture(t);
    git(f.repo, 'checkout', '--quiet', '-b', 'new-preview');
    assert.equal(ignoredExit(f.repo, app, undefined), 1);
    assert.equal(ignoredExit(f.repo, app, ''), 1);
  });

  test(`${app}: unknown and malformed previous SHAs build`, (t) => {
    const f = fixture(t);
    for (const previous of ['0'.repeat(40), 'HEAD^', '--no-index', f.previous.slice(0, 12)]) {
      assert.equal(ignoredExit(f.repo, app, previous), 1, previous);
    }
  });

  test(`${app}: shallow history missing the previous commit builds`, (t) => {
    const f = fixture(t);
    f.change('supabase/migration.sql');
    f.commit('SQL only');
    const shallow = path.join(f.root, 'shallow');
    git(f.root, 'clone', '--quiet', '--depth=1', pathToFileURL(f.repo).href, shallow);
    assert.equal(git(shallow, 'rev-parse', '--is-shallow-repository'), 'true');
    assert.equal(ignoredExit(shallow, app, f.previous), 1);
  });

  test(`${app}: git errors normalize to build rather than an ambiguous exit status`, (t) => {
    const f = fixture(t);
    const noGit = path.join(f.root, 'no-git');
    fs.mkdirSync(path.join(noGit, app), { recursive: true });
    assert.equal(ignoredExit(noGit, app, f.previous), 1);
  });
}
