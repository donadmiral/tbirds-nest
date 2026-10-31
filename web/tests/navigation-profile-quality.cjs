const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const web = path.resolve(__dirname, '..');
function load(name) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(web, 'lib', name + '.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, URL });
  return module.exports;
}
const navigation = load('navigation'), profile = load('profileForm');
test('every static primary and More destination resolves to an actual App Router page', () => {
  for (const item of [...navigation.PRIMARY_DESTINATIONS, ...navigation.MORE_DESTINATIONS]) {
    assert.ok(fs.existsSync(path.join(web, 'app', item.href, 'page.tsx')), item.href + ' must have a page');
    assert.ok(item.label.trim());
  }
});
test('nested destinations stay selected without confusing similar path prefixes', () => {
  assert.equal(navigation.isDestinationActive('/market/orders', '/market'), true);
  assert.equal(navigation.isDestinationActive('/marketplace', '/market'), false);
  assert.equal(navigation.isDestinationActive('/jobs/messages', '/messages'), false);
});
test('direct record navigation has a deterministic internal parent', () => {
  for (const [route, destination] of [['/story/new','/home'],['/post/id','/home'],['/album/id','/home'],['/jobs/role-id','/jobs'],['/market/item-id','/market'],['/communities/community-id','/communities'],['/topic/coast','/discover']]) assert.equal(navigation.parentDestination(route).href, destination);
  assert.equal(navigation.parentDestination('/home'), null);
});
test('profile web links accept https and bare hostnames while blocking active or credentialed URLs', () => {
  assert.equal(profile.normalizeProfileUrl('portfolio.example/work'), 'https://portfolio.example/work');
  assert.equal(profile.normalizeProfileUrl('https://example.com/notes?q=1#latest'), 'https://example.com/notes?q=1#latest');
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd', 'https://user:secret@example.com', 'https://exa\nmple.com', 'https://example.com\u0000', 'https://example.com/' + 'a'.repeat(2050)]) assert.equal(profile.normalizeProfileUrl(url), null, url.slice(0,50));
});
test('malformed historical profile links do not become clickable actions', () => {
  assert.equal(profile.safeProfileLinks('broken').length, 0);
  const links = profile.safeProfileLinks([null, { url: 'javascript:alert(1)' }, { title: 'Work', url: 'example.com/work' }, { title: 'Credentials', url: 'https://u:p@example.com' }]);
  assert.equal(links.length, 1); assert.equal(links[0].url, 'https://example.com/work');
});
test('profile validation rejects missing identity, long text and an invalid link without mutating the draft', () => {
  const draft = { ...profile.EMPTY_PROFILE, full_name: ' Avery ', links: [{ title: ' Work ', url: 'example.com' }] };
  const valid = profile.validatedProfile(draft);
  assert.equal(valid.full_name, 'Avery'); assert.equal(valid.links[0].title, 'Work'); assert.equal(draft.full_name, ' Avery ');
  assert.throws(() => profile.validatedProfile({ ...draft, full_name: ' ' }), /Enter your name/);
  assert.throws(() => profile.validatedProfile({ ...draft, bio: 'x'.repeat(501) }), /500/);
  assert.throws(() => profile.validatedProfile({ ...draft, links: [{ title: 'Unsafe', url: 'javascript:x' }] }), /valid http or https/);
  assert.throws(() => profile.validatedProfile({ ...draft, links: Array(6).fill({ title: '', url: 'example.com' }) }), /five/);
});
