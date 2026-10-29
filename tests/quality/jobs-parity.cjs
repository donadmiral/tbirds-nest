const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children ?? '');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function compile(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date, console, URL, require(name) {
    if (name in mocks) return mocks[name];
    if (name.endsWith('/shared/hiring')) return compile('shared/hiring.ts');
    if (name.endsWith('/shared/studioValidation')) return compile('shared/studioValidation.ts');
    throw new Error('Unexpected dependency: ' + name);
  } });
  return module.exports;
}
const theme = compile('src/constants/tokens/light.ts').light;
const row = n => ({ id: id(n + 100), applicant_id: id(n + 200), status: 'applied', applied_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', applicant: { full_name: 'Candidate ' + n }, tags: [], notes: [] });
const job = n => ({ id: id(n), title: 'Role ' + n, company: 'Company', closed: false, counts: { total: 62 } });
const page = (rows, more = false) => ({ data: { applications: rows, counts: { all: 62, applied: 62 }, has_more: more, cursor: more ? { id: rows.at(-1).id, applied_at: rows.at(-1).applied_at } : null }, error: null });

function recruiterHarness(rpc) {
  const slots = [], effects = [], calls = [], alerts = [];
  let cursor = 0, tree, user = 'owner';
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = fn(); }); } },
  };
  const jsx = (type, props) => ({ type, props });
  const native = new Proxy({ StyleSheet: { hairlineWidth: 1 }, Platform: { OS: 'ios' }, Alert: { alert: (...args) => alerts.push(args) } }, { get(target, name) { return target[name] ?? String(name); } });
  const mod = compile('src/screens/studio/StudioHiringAdsSegs.tsx', {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    '../../theme/useTheme': { themedSheet: fn => fn(theme), getTheme: () => theme, useTheme() {} },
    '../../components/SafeArea': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../../components/StudioLoadError': { StudioLoadError: 'StudioLoadError' },
    '../../stores/authStore': { useAuthStore: fn => fn({ profile: { id: user } }) },
    '../../services/supabase': { supabase: { rpc: (name, args) => { calls.push({ name, args }); return rpc(name, args); } } },
    '../../services/applicationCvService': { applicationCvUrl: async () => 'https://example.test/cv' },
    '@expo/vector-icons': { Feather: 'Feather' }, 'expo-image': { Image: 'Image' },
  });
  const render = () => { cursor = 0; tree = mod.RecruiterSeg({ role: 'owner', navigation: {}, onBack() {} }); effects.splice(0).forEach(fn => fn()); };
  const nodes = () => {
    const found = [];
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      found.push(node); walk(node.props?.children);
      if (node.type === 'FlatList') {
        walk(node.props.ListHeaderComponent);
        if (!node.props.data.length) walk(node.props.ListEmptyComponent);
        node.props.data.forEach((item, index) => walk(node.props.renderItem({ item, index })));
        walk(node.props.ListFooterComponent);
      }
    };
    walk(tree); return found;
  };
  const press = label => { const button = nodes().find(n => n.type === 'TouchableOpacity' && text(n) === label); assert.ok(button, 'Missing button: ' + label); button.props.onPress(); render(); };
  const openJob = n => { const list = nodes().find(node => node.type === 'FlatList'); list.props.renderItem({ item: list.props.data.find(j => j.id === id(n)) }).props.onPress(); render(); };
  const flush = async () => { for (let n = 0; n < 5; n++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  return { render, nodes, press, openJob, flush, calls, alerts, get text() { return nodes().filter(n => n.type === 'Text').map(text).join(' '); }, setUser(value) { user = value; render(); } };
}

test('native recruiter uses server totals and cursor pages instead of truncating the list', async () => {
  const all = Array.from({ length: 62 }, (_, n) => row(n));
  const h = recruiterHarness(async (name, args) => name === 'studio_jobs' ? { data: [job(1)] } : page(args.p_before_id ? all.slice(25, 50) : all.slice(0, 25), true));
  h.render(); await h.flush(); h.openJob(1); await h.flush();
  assert.match(h.text, /All · 62/);
  assert.equal(h.nodes().find(n => n.type === 'FlatList').props.data.length, 25);
  h.press('Load more applicants'); await h.flush();
  assert.equal(h.nodes().find(n => n.type === 'FlatList').props.data.length, 50);
  const requests = h.calls.filter(c => c.name === 'studio_applicant_page');
  assert.equal(requests.length, 2); assert.equal(requests[1].args.p_before_id, all[24].id);
  assert.equal(requests[1].args.p_limit, 25);
});

test('native recruiter exposes failed reads as retryable errors, not no applications', async () => {
  let failed = true;
  const h = recruiterHarness(async name => name === 'studio_jobs' ? { data: [job(1)] } : failed ? { error: { message: 'Connection unavailable' } } : page([row(1)]));
  h.render(); await h.flush(); h.openJob(1); await h.flush();
  assert.match(h.text, /Connection unavailable/); assert.doesNotMatch(h.text, /No applications yet/);
  failed = false; h.press('Try again'); await h.flush(); assert.match(h.text, /Candidate 1/);
});

test('native recruiter ignores a late previous-stage response', async () => {
  const first = deferred();
  const h = recruiterHarness(async (name, args) => name === 'studio_jobs' ? { data: [job(1)] } : args.p_status === 'all' ? first.promise : page([{ ...row(2), status: 'rejected' }]));
  h.render(); await h.flush(); h.openJob(1); await h.flush(); h.press('Rejected'); await h.flush();
  first.resolve(page([row(1)])); await h.flush();
  assert.match(h.text, /Candidate 2/); assert.doesNotMatch(h.text, /Candidate 1/);
});

test('native recruiter clears private applicants when the signed-in identity changes', async () => {
  const first = deferred(); let reads = 0;
  const h = recruiterHarness(async name => name === 'studio_jobs' ? { data: ++reads === 1 ? [job(1)] : [] } : first.promise);
  h.render(); await h.flush(); h.openJob(1); await h.flush(); h.setUser('another-owner'); await h.flush(); first.resolve(page([row(1)])); await h.flush();
  assert.doesNotMatch(h.text, /Candidate 1/);
});

test('jobs back follows the current stack, and direct links have a real tab destination', () => {
  const { jobsBack } = compile('src/navigation/jobsNavigation.ts');
  const calls = [], nav = { canGoBack: () => true, goBack: () => calls.push('back'), navigate: (...args) => calls.push(args) };
  jobsBack(nav); nav.canGoBack = () => false; jobsBack(nav); jobsBack(nav, true);
  assert.equal(JSON.stringify(calls), JSON.stringify(['back', ['Main', { screen: 'Jobs' }], ['Main', { screen: 'Studio' }]]));
});

function pageHarness(file, read, extraMocks = {}) {
  const slots = [], effects = [], queries = [];
  let cursor = 0, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = fn(); }); } },
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } }, error: null }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
    from(table) {
      queries.push(table);
      const q = new Proxy({}, { get(_, method) { return method === 'then' ? (resolve, reject) => Promise.resolve().then(() => read(table)).then(resolve, reject) : () => q; } });
      return q;
    },
  };
  const jsx = (type, props) => ({ type, props });
  const native = new Proxy({ StyleSheet: { hairlineWidth: 1 }, Platform: { OS: 'ios' }, Alert: { alert() {} } }, { get(target, name) { return target[name] ?? String(name); } });
  const stub = new Proxy({}, { get: (_, name) => String(name) });
  const routeSnapshot = { id: id(1), posted_by: 'employer', title: 'Engineer', company: 'Company', deadline: null, created_at: '2026-01-01' };
  const mod = compile(file, {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'next/link': { __esModule: true, default: 'Link' }, 'lucide-react': stub,
    '@/lib/supabase/client': { createClient: () => client }, '@/lib/jobs': compile('web/lib/jobs.ts'), '@/components/JobCard': { JobCard: 'JobCard' },
    '../../theme/useTheme': { themedSheet: fn => fn(theme), getTheme: () => theme, useTheme: () => ({ isDark: false }) },
    '../../components/SafeArea': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../../components/skeletons': { JobSkeleton: 'JobSkeleton' }, '../../components/TierName': stub, '../../components/VerifiedBadge': stub,
    '../../lib/screenTransition': { useAfterTransition: () => true },
    '../../stores/authStore': { useAuthStore: Object.assign(fn => fn({ profile: { id: 'owner' } }), { getState: () => ({ profile: { id: 'owner' }, session: { user: { id: 'owner' } } }) }) },
    '../../services/supabase': { supabase: client },
    '../../services/jobsService': { jobsService: {}, isJobDeadlinePassed: (deadline, now = Date.now()) => !!deadline && Date.parse(deadline) <= now },
    '../../services/applicationCvService': { uploadApplicationCv() {} }, '../../../shared/applicationCv': { applicationCvFile() {} },
    '../../navigation/jobsNavigation': compile('src/navigation/jobsNavigation.ts'),
    '@react-navigation/native': { useFocusEffect: fn => hooks.useEffect(fn, [fn]), useNavigation: () => ({ canGoBack: () => true, goBack() {}, navigate() {} }), useRoute: () => ({ params: { job: routeSnapshot } }) },
    '@expo/vector-icons': { Feather: 'Feather', Ionicons: 'Ionicons' }, 'expo-document-picker': stub,
    ...extraMocks,
  });
  const render = () => { cursor = 0; tree = mod.default(); effects.splice(0).forEach(fn => fn()); };
  const flush = async () => { for (let n = 0; n < 6; n++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  return { render, flush, queries, get text() { return text(tree); } };
}

test('native detail verifies a route snapshot before offering an application to a now-closed job', async () => {
  const h = pageHarness('src/screens/jobs/JobDetailScreen.tsx', async table => ({ data: table === 'jobs' ? { id: id(1), posted_by: 'employer', title: 'Engineer', company: 'Company', deadline: '2020-01-01', created_at: '2026-01-01' } : null, error: null }));
  h.render(); assert.match(h.text, /Checking application details/); await h.flush();
  assert.ok(h.queries.includes('jobs')); assert.match(h.text, /deadline has passed/); assert.doesNotMatch(h.text, /Apply now/);
});

test('native detail cannot offer Apply when application history failed to load', async () => {
  const h = pageHarness('src/screens/jobs/JobDetailScreen.tsx', async table => ({ data: table === 'jobs' ? { id: id(1), posted_by: 'employer', title: 'Engineer', company: 'Company', deadline: null, created_at: '2026-01-01' } : null, error: table === 'job_applications' ? { message: 'offline' } : null }));
  h.render(); await h.flush(); assert.match(h.text, /Could not check your application/); assert.doesNotMatch(h.text, /Apply now/);
});

test('web browse renders a retry state instead of claiming an empty jobs catalogue on query failure', async () => {
  const h = pageHarness('web/app/jobs/page.tsx', async table => table === 'jobs' ? { data: null, error: { message: 'offline' } } : { data: table === 'job_saves' ? [] : null, error: null });
  h.render(); await h.flush(); assert.match(h.text, /Jobs could not be loaded/); assert.match(h.text, /Try again/); assert.doesNotMatch(h.text, /No jobs match/);
});
