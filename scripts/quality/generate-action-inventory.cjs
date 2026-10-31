// Static acceptance inventory; this deliberately does not mark source bindings as runtime-tested.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const date = process.argv[2] || '20261029';
if (!/^\d{8}$/.test(date)) throw new Error('Use a YYYYMMDD inventory date');
const files = [...new Set(cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0'))]
  .filter(file => /^(src\/|web\/(app|components)\/|admin-web\/(app|components)\/)/.test(file) && /\.(tsx|jsx)$/.test(file)).sort();
const eventName = /^(onPress|onLongPress|onClick|onDoubleClick|onSubmit|onChange|onChangeText|onValueChange|onSelect|onConfirm|onCancel|onDismiss|onClose|onNext|onBack|onComplete|onSave|onDelete|onRemove|onEdit|onToggle|onSearch|onReply|onShare|onRetry|onRefresh|onEndReached|onScroll|onFocus|onBlur|onKeyDown|onKeyUp|onDragStart|onDragEnd|onDrop|onSwipe|onSeek|onPlay|onPause|onRate|onReport|onBlock|onUnblock|onPin|onUnpin|onMute|onUnmute|onAccept|onDecline|onSend|onExit|onDone|onReset|onClear|onPick|onUpload|onOpen|onRequestClose|action)$/;
const clean = text => text.replace(/\s+/g, ' ').trim();
const brief = text => clean(text).slice(0, 180);
const plain = node => {
  if (!node) return '';
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isJsxExpression(node)) return plain(node.expression);
  return '';
};
function childText(node) {
  if (ts.isJsxText(node)) return clean(node.text);
  if (ts.isJsxExpression(node)) return plain(node.expression);
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) return node.children.map(childText).filter(Boolean).join(' ');
  return '';
}
const inventory = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const actions = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      const attrs = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(ast), a.initializer]));
      const events = [...attrs.keys()].filter(name => eventName.test(name));
      const href = attrs.has('href') && /^(a|Link|NextLink)$/.test(tag);
      const submit = (tag === 'input' || tag === 'button') && plain(attrs.get('type')) === 'submit';
      if (events.length || href || submit) {
        const label = ['accessibilityLabel', 'aria-label', 'label', 'title', 'placeholder', 'testID'].map(key => plain(attrs.get(key))).find(Boolean)
          || (ts.isJsxOpeningElement(node) ? childText(node.parent) : '') || plain(attrs.get('value')) || tag + ' (dynamic/unlabelled)';
        const point = ast.getLineAndCharacterOfPosition(node.getStart(ast));
        actions.push({ line: point.line + 1, kind: 'JSX control/callback', control: tag, label: brief(label), events: [...events, ...(href ? ['href'] : []), ...(submit ? ['submit'] : [])],
          handlers: Object.fromEntries(events.map(name => [name, brief(attrs.get(name)?.getText(ast) || '')])),
          destination: href ? brief(attrs.get('href')?.getText(ast) || '') : null, acceptance: 'Pending authenticated browser/device execution' });
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'Alert.alert') {
      const buttons = node.arguments[2];
      if (buttons && ts.isArrayLiteralExpression(buttons)) for (const button of buttons.elements) {
        if (!ts.isObjectLiteralExpression(button)) continue;
        const props = new Map(button.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(ast), p.initializer]));
        if (!props.has('onPress')) continue;
        actions.push({ line: ast.getLineAndCharacterOfPosition(button.getStart(ast)).line + 1, kind: 'Native alert action', control: 'Alert button', label: brief(plain(props.get('text')) || 'Dynamic confirmation'),
          events: ['onPress'], handlers: { onPress: brief(props.get('onPress').getText(ast)) }, destination: null, acceptance: 'Pending physical-device execution' });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  inventory.push({ app: file.startsWith('admin-web/') ? 'admin' : file.startsWith('web/') ? 'web' : 'native', file, actions });
}
const summary = Object.fromEntries(['native', 'web', 'admin'].map(app => [app, { files: inventory.filter(f => f.app === app).length, filesWithBindings: inventory.filter(f => f.app === app && f.actions.length).length, bindings: inventory.filter(f => f.app === app).reduce((sum, f) => sum + f.actions.length, 0) }]));
const out = path.join(root, 'docs/quality');
const compact = inventory.map(file => ({ app: file.app, file: file.file, actions: file.actions.map(action => [action.line, action.kind === 'Native alert action' ? 'alert' : 'jsx', action.control, action.label, action.events, action.destination]) }));
fs.writeFileSync(path.join(out, 'APP_ACTION_ACCEPTANCE_' + date + '.json'), JSON.stringify({ date, scope: 'Tracked and current JSX controls, selected interaction callbacks, links and literal native Alert actions; includes delegated component props and conditional controls.', status: 'Static inventory only; every runtime result remains pending.', actionFields: ['line', 'kind', 'control', 'label', 'events', 'destination'], summary, files: compact }) + '\n');
const escape = text => text.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
const lines = ['# App action acceptance inventory — ' + date, '', '**This is the action-by-action execution checklist, not completed device acceptance.** The static scan includes native screens and components, web app/components, and admin app/components. Component callbacks can describe the same visible control more than once, and conditional/dynamically generated controls are not guaranteed to appear in a source scan.', '',
  'For each applicable signed-out, member, author, applicant/employer, buyer/seller, moderator and staff role: record the exact source/build, enter the screen, trigger the control, verify the destination and data outcome, check Back/Cancel/Next, and repeat relevant rejected-write, denied-permission and offline/retry paths. Record Pass, Fail, Not applicable or Blocked with a reason. Screen registration and automated suites do not mark these rows passed.', '',
  'An authenticated browser session, intentional test accounts/records, and a permitted development iPhone environment are required. TestFlight remains on hold. Provider-specific actions stay blocked until their real provider environment is available. Exact source positions and machine-readable control bindings are in the JSON companion.', '',
  '| App | JSX files scanned | Files with bindings | Interaction bindings |', '| --- | ---: | ---: | ---: |', ...Object.entries(summary).map(([app, s]) => '| ' + app + ' | ' + s.files + ' | ' + s.filesWithBindings + ' | ' + s.bindings + ' |'), '',
  '## Per-file controls', ''];
for (const entry of inventory) {
  if (!entry.actions.length) continue;
  lines.push('### ' + entry.file, '', '| Source line | Control or label | Interaction | Runtime result |', '| ---: | --- | --- | --- |');
  for (const action of entry.actions) lines.push('| ' + action.line + ' | ' + escape(action.label) + ' | ' + escape(action.events.join(', ')) + ' | Pending |');
  lines.push('');
}
lines.push('## Files with no directly inventoried bindings', '', 'These files may delegate actions to shared components, use dynamic handlers outside this scan, or display content without direct controls. A zero count does not certify that a screen has no actions.', '', ...inventory.filter(file => !file.actions.length).map(file => '- ' + file.file), '');
fs.writeFileSync(path.join(out, 'APP_ACTION_ACCEPTANCE_' + date + '.md'), lines.join('\n'));
console.log(JSON.stringify({ summary, files: inventory.length, bindings: Object.values(summary).reduce((sum, row) => sum + row.bindings, 0) }));
