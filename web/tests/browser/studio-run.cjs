/** Actual Studio UI. Synthetic records/adapters: no signed-in backend or provider. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../../node_modules/playwright');
const output = process.env.PLATINUM_STUDIO_UI_OUTPUT || '/tmp/platinum-studio-browser';
const artifacts = process.env.PLATINUM_STUDIO_UI_ARTIFACTS || path.resolve(__dirname, '../../../docs/quality/studio-ui-20261030');
const checks = [], errors = [];
async function check(name, action) { await action(); checks.push(name); console.log('PASS', name); }
async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const file = ['fixture.js', 'fixture.css'].includes(pathname.slice(1)) ? pathname.slice(1) : 'index.html';
    try { const data = await fs.readFile(path.join(output, file)); res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(data); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.PLATINUM_CHROMIUM || '/tmp/platinum-memory-browsers/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1586, height: 992 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack || error.message); });
  const capture = async options => {
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('aside').forEach(node => { node.scrollTop = 0; }); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot(options);
  };
  const go = async route => { await page.goto(origin + route); await page.getByRole('navigation', { name: 'Studio navigation', exact: true }).waitFor(); };
  const nav = name => page.getByRole('navigation', { name: 'Studio navigation', exact: true }).getByRole('link', { name, exact: true });
  try {
    await go('/studio');
    await check('Professional shell uses a dedicated rail with a real return to the public app', async () => {
      await page.getByRole('heading', { name: 'Business Studio', exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Back to Platinum Circles', exact: true }).getAttribute('href'), '/home');
      for (const name of ['Overview', 'Content', 'Planner', 'Newsroom', 'Partnerships', 'Ads', 'Earnings', 'Team', 'Settings']) await nav(name).waitFor();
      const icons = await page.getByRole('navigation', { name: 'Studio navigation', exact: true }).locator('svg').evaluateAll(nodes => nodes.map(node => [node.getAttribute('viewBox'), node.getAttribute('stroke-width')]));
      assert.ok(icons.length >= 15); for (const icon of icons) assert.deepEqual(icon, ['0 0 24 24', '1.65']);
    });
    await check('Tool search focuses, filters actual destinations and restores focus on Escape', async () => {
      const trigger = page.getByRole('button', { name: 'Search Studio tools', exact: true }); await trigger.click();
      const field = page.getByRole('textbox', { name: 'Find a Studio tool', exact: true }); await field.waitFor();
      assert.equal(await field.evaluate(node => node === document.activeElement), true); await field.fill('newsroom');
      assert.equal(await page.getByRole('dialog', { name: 'Search Studio', exact: true }).getByRole('link').count(), 1);
      assert.equal(await page.getByRole('dialog', { name: 'Search Studio', exact: true }).getByRole('link').getAttribute('href'), '/studio/newsroom');
      await page.keyboard.press('Escape'); assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    });
    await check('Overview publishing queue opens the exact draft and failed-upload destination', async () => {
      assert.equal(await page.getByRole('link', { name: 'Publishing issues 1', exact: false }).getAttribute('href'), '/studio/planner?filter=failed');
      const row = page.getByRole('row').filter({ hasText: 'Halftime highlights' });
      assert.equal(await row.getByRole('link', { name: 'Open', exact: true }).getAttribute('href'), '/studio/planner?edit=20000000-0000-4000-8000-000000000001');
    });
    await capture({ path: path.join(artifacts, 'studio-overview-desktop.png'), fullPage: true });
    await nav('Ads').click(); await page.getByRole('heading', { name: 'Ads Manager', exact: true }).waitFor();
    await check('Campaign filtering cannot leave an actionable hidden campaign selected', async () => {
      await page.getByRole('textbox', { name: 'Search campaigns', exact: true }).fill('WEEKEND');
      await page.getByRole('region', { name: 'Selected campaign', exact: true }).getByRole('heading', { name: 'Weekend highlights', exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: 'Selected campaign', exact: true }).getByText('Season passes', { exact: true }).count(), 0);
      await page.getByRole('textbox', { name: 'Search campaigns', exact: true }).fill('no match');
      await page.getByRole('heading', { name: 'No matching campaigns', exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: 'Selected campaign', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    });
    await capture({ path: path.join(artifacts, 'studio-ads-desktop.png'), fullPage: true });
    await check('Campaign creation validates the budget and saves a draft after a review step', async () => {
      await page.getByRole('button', { name: 'Create campaign', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Create campaign', exact: true });
      await dialog.getByRole('textbox', { name: 'Campaign name', exact: true }).fill('Browser checked campaign');
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
      await dialog.getByRole('textbox', { name: 'Campaign budget', exact: true }).fill('-1'); await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
      await dialog.getByRole('alert').waitFor(); assert.equal(await dialog.getByRole('button', { name: 'Save campaign draft', exact: true }).count(), 0);
      await dialog.getByRole('textbox', { name: 'Campaign budget', exact: true }).fill('100');
      await dialog.getByRole('combobox', { name: 'Funding provider', exact: false }).selectOption('intobank');
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click(); await dialog.getByRole('heading', { name: 'Review your campaign', exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Save campaign draft', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      const requests = await page.evaluate(() => window.__studioFixture.requests()); const save = requests.filter(request => request.name === 'studio_save_campaign').at(-1);
      assert.equal(save.args.p_name, 'Browser checked campaign'); assert.equal(save.args.p_budget, 100); assert.equal(save.args.p_payment_method, 'intobank');
      assert.equal(requests.some(request => request.name === 'studio_submit_campaign'), false, 'saving does not submit or activate');
    });
    await check('Advertising review keeps submission blocked until creative is present', async () => {
      await page.getByRole('button', { name: 'Review campaign', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Review campaign', exact: true });
      assert.equal(await dialog.getByRole('button', { name: 'Submit for review', exact: true }).isDisabled(), true);
      await dialog.getByRole('button', { name: 'Back to Ads Manager', exact: true }).click();
    });
    await check('Failed ad-picker loading is shown with retry and retains the current campaign', async () => {
      await page.evaluate(() => window.__studioFixture.failNext('studio_my_posts_for_ads'));
      await page.getByRole('region', { name: 'Selected campaign', exact: true }).getByRole('button', { name: 'Add ad', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add an ad to Browser checked campaign', exact: true });
      await dialog.getByRole('alert').waitFor(); assert.equal(await dialog.getByText('No posts yet.', { exact: false }).count(), 0);
      await dialog.getByRole('button', { name: /Retry|Try again/ }).click(); await dialog.getByRole('button', { name: /The weekend starts here/ }).click();
      await dialog.waitFor({ state: 'hidden' }); await page.getByRole('button', { name: 'Review campaign', exact: true }).click();
      const review = page.getByRole('dialog', { name: 'Review campaign', exact: true });
      assert.equal(await review.getByRole('button', { name: 'Submit for review', exact: true }).isEnabled(), true);
      await review.getByRole('button', { name: 'Submit for review', exact: true }).click(); await review.waitFor({ state: 'hidden' });
      await page.getByText('Campaign submitted for platform advertising review.', { exact: true }).waitFor();
    });
    await nav('Insights').click();
    await check('Insights separates organic and paid reports and exposes exact daily chart values', async () => {
      await page.getByRole('heading', { name: 'Performance over time', exact: true }).waitFor();
      await page.getByText('View daily data', { exact: true }).click();
      assert.equal(await page.getByRole('table', { name: 'Content impressions for each reported day', exact: true }).getByRole('row').count(), 8);
      await page.getByRole('combobox', { name: 'Chart metric', exact: true }).selectOption('reach');
      await page.getByRole('table', { name: 'Daily reach total for each reported day', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Paid campaigns', exact: true }).click();
      assert.equal(await page.getByRole('combobox', { name: 'Chart metric', exact: true }).inputValue(), 'ad_impressions');
      await page.getByRole('table', { name: 'Ad impressions for each reported day', exact: true }).waitFor();
    });
    await check('A failed Insights period change retains and labels the last confirmed report', async () => {
      await page.evaluate(() => window.__studioFixture.failNext('studio_insights'));
      await page.getByRole('combobox', { name: 'Reporting period', exact: true }).selectOption('7');
      await page.getByRole('alert').waitFor(); await page.getByRole('status').filter({ hasText: 'Showing the last confirmed 30-day report' }).waitFor();
      assert.equal(await page.getByRole('table', { name: 'Ad impressions for each reported day', exact: true }).getByRole('row').count(), 8);
      await page.getByRole('alert').getByRole('button', { name: /Retry|Try again/ }).click();
      await page.getByText('7 reported days in the 7-day period', { exact: true }).waitFor(); assert.equal(await page.getByRole('alert').count(), 0);
      await page.getByText('View daily data', { exact: true }).click();
    });
    await capture({ path: path.join(artifacts, 'studio-insights-desktop.png'), fullPage: true });
    await go('/studio/planner?edit=20000000-0000-4000-8000-000000000001');
    await check('Planner deep link opens the intended draft and guards Cancel against unsaved changes', async () => {
      const dialog = page.getByRole('dialog', { name: 'Edit planned post', exact: true }); await dialog.waitFor();
      const caption = dialog.getByRole('textbox', { name: 'Caption', exact: false }); assert.equal(await caption.inputValue(), 'Halftime highlights');
      await caption.fill('Keep this draft change'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      const discard = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true }); await discard.waitFor();
      await discard.getByRole('button', { name: 'Keep editing', exact: true }).click(); assert.equal(await caption.inputValue(), 'Keep this draft change');
      await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
      const preview = page.getByRole('dialog', { name: 'Post preview', exact: true }); await preview.getByText('Keep this draft change', { exact: true }).waitFor();
      await preview.getByRole('button', { name: 'Back to editing', exact: true }).click();
      await dialog.getByRole('button', { name: 'Save draft', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      const request = await page.evaluate(() => window.__studioFixture.requests().filter(request => request.name === 'studio_save_post').at(-1));
      assert.equal(request.args.p_id, '20000000-0000-4000-8000-000000000001'); assert.equal(request.args.p_content, 'Keep this draft change');
    });
    await nav('Newsroom').click(); await page.getByRole('heading', { name: 'Review & approval', exact: true }).waitFor();
    await capture({ path: path.join(artifacts, 'studio-newsroom-desktop.png'), fullPage: true });
    await check('Newsroom reads the linked draft before review and requires feedback for requested changes', async () => {
      await page.getByText('Keep this draft change', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Request changes', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Request changes', exact: true });
      assert.equal(await dialog.getByRole('button', { name: 'Request changes', exact: true }).isDisabled(), true);
      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    });
    await check('Ambiguous workflow submission preserves one exact request and safely retries it', async () => {
      await page.evaluate(() => window.__studioFixture.ambiguousNext('studio_newsroom_transition'));
      await page.getByRole('button', { name: 'Approve content', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Approve content', exact: true });
      await dialog.getByRole('button', { name: 'Approve content', exact: true }).click(); await dialog.getByRole('button', { name: 'Retry saved request', exact: true }).waitFor();
      const first = await page.evaluate(() => window.__studioFixture.requests().filter(request => request.name === 'studio_newsroom_transition').at(-1));
      assert.match(first.args.p_request_key, /^[0-9a-f-]{36}$/); assert.equal(first.args.p_expected_user, '10000000-0000-4000-8000-000000000001');
      await page.reload(); await page.getByRole('button', { name: 'Retry saved request', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Retry saved request', exact: true }).click();
      await page.getByRole('button', { name: 'Schedule approved post', exact: true }).waitFor();
      const request = await page.evaluate(() => window.__studioFixture.requests().filter(request => request.name === 'studio_newsroom_transition').at(-1));
      assert.deepEqual(request.args, first.args); assert.equal(await page.getByRole('button', { name: 'Retry saved request', exact: true }).count(), 0);
    });
    await check('Scheduling requires a separate confirmation with the approved publication time', async () => {
      await page.getByRole('button', { name: 'Schedule approved post', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Approve schedule', exact: true });
      await dialog.getByText('Rights, embargo and the exact approved creative are checked again.', { exact: false }).waitFor();
      await dialog.getByRole('button', { name: 'Approve schedule', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      await page.getByText('Content scheduled', { exact: true }).waitFor();
    });
    await nav('Partnerships').click(); await page.getByRole('heading', { name: 'Campaign brief', exact: true }).waitFor();
    await capture({ path: path.join(artifacts, 'studio-partnerships-desktop.png'), fullPage: true });
    await check('Business deliverable approval does not grant either creator permission', async () => {
      await page.getByRole('button', { name: 'Approve deliverable', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Approve deliverable', exact: true });
      await dialog.getByRole('button', { name: 'Approve deliverable', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      await page.getByText('Deliverable approved', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Grant permission', exact: true }).count(), 0);
      const row = await page.evaluate(() => window.__studioFixture.records().partnerships[0]); assert.equal(row.publishing_granted, false); assert.equal(row.paid_promotion_granted, false);
    });
    await check('Switching to the named creator exposes permission controls with expiry and explicit consent', async () => {
      await page.evaluate(() => window.__studioFixture.setActor('creator'));
      await page.getByRole('navigation', { name: 'Studio navigation', exact: true }).getByRole('link', { name: 'Partnerships', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Grant permission', exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Grant publishing permission', exact: true });
      assert.equal(await dialog.getByRole('button', { name: 'Grant permission', exact: true }).isDisabled(), true);
      const expiry = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 16);
      await dialog.getByLabel('Permission expires', { exact: false }).fill(expiry); await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Grant permission', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Revoke permission', exact: true }).waitFor();
      const row = await page.evaluate(() => window.__studioFixture.records().partnerships[0]); assert.equal(row.publishing_granted, true); assert.equal(row.paid_promotion_granted, false);
      const request = await page.evaluate(() => window.__studioFixture.requests().filter(request => request.name === 'studio_partnership_permission').at(-1)); assert.equal(request.args.p_expected_user, '10000000-0000-4000-8000-000000000002'); assert.equal(request.args.p_permission, 'publishing');
    });
    await check('A changed source invalidates displayed consent and still allows revoking the recorded grant', async () => {
      await page.evaluate(() => window.__studioFixture.changePartnershipSource()); await page.reload();
      await page.getByText('The linked source changed or is no longer available.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Grant permission', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Submit version', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Revoke permission', exact: true }).waitFor();
    });
    await check('Creator permission can be revoked without accidentally granting paid promotion', async () => {
      await page.getByRole('button', { name: 'Revoke permission', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Revoke publishing permission', exact: true });
      await dialog.getByRole('button', { name: 'Revoke permission', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      const row = await page.evaluate(() => window.__studioFixture.records().partnerships[0]); assert.equal(row.publishing_granted, false); assert.equal(row.paid_promotion_granted, false);
    });
    await nav('Earnings').click(); await page.getByRole('heading', { name: 'Earnings', exact: true }).waitFor();
    await check('Earnings preserves provider restrictions and does not turn absent balances into invented totals', async () => {
      await page.getByText('IntoBank creator payouts are not available yet.', { exact: true }).waitFor();
      await page.getByText('No balance recorded in this category', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /Request payout|Withdraw earnings/ }).count(), 0);
      await page.getByRole('button', { name: 'Payouts', exact: true }).click(); await page.getByRole('heading', { name: 'No payout requests recorded', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Overview', exact: true }).click();
    });
    await capture({ path: path.join(artifacts, 'studio-earnings-desktop.png'), fullPage: true });
    await check('Creator routes remain available and business-only tools have an intentional return path', async () => {
      await page.goto(origin + '/studio/ads'); await page.getByRole('heading', { name: 'A business workspace is required', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Back to Creator Studio', exact: true }).click(); await page.getByRole('heading', { name: 'Creator Studio', exact: true }).waitFor();
      assert.equal(await nav('Earnings').getAttribute('href'), '/studio/earnings'); assert.equal(await nav('Partnerships').getAttribute('href'), '/studio/partnerships');
    });
    await page.evaluate(() => window.__studioFixture.setActor('business')); await nav('Team').click();
    await check('Team navigation opens real organization members and links to protected business codes', async () => {
      await page.getByRole('heading', { name: 'Team & access', exact: true }).waitFor(); await page.getByText('Riya Patel', { exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Manage business sign-in codes and devices', exact: true }).getAttribute('href'), '/studio/settings#business-access-team');
    });
    await capture({ path: path.join(artifacts, 'studio-team-desktop.png'), fullPage: true });
    await nav('Settings').click();
    await check('Member creation binds the submitted identity and uses least privilege by default', async () => {
      await page.getByRole('textbox', { name: 'New member name', exact: true }).fill('Fixture editor');
      const role = page.getByRole('combobox', { name: 'New member role', exact: true }); assert.equal(await role.inputValue(), 'editor');
      await page.getByRole('button', { name: 'Issue access code', exact: true }).click();
      await page.getByText('SYNTHETIC-CODE', { exact: true }).waitFor();
      const request = await page.evaluate(() => window.__studioFixture.requests().filter(request => request.name === 'studio_create_member').at(-1));
      assert.equal(request.args.p_expected_user, '10000000-0000-4000-8000-000000000001'); assert.equal(request.args.p_role, 'editor');
    });
    await nav('Newsroom').click(); await page.getByRole('heading', { name: 'Newsroom', exact: true }).waitFor();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await check('Dark Studio inherits readable surfaces while retaining professional navigation', async () => {
      const color = await page.getByRole('heading', { name: 'Newsroom', exact: true }).evaluate(node => getComputedStyle(node).color); assert.notEqual(color, 'rgb(15, 29, 50)');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    });
    await capture({ path: path.join(artifacts, 'studio-newsroom-dark.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.remove('dark')); await page.setViewportSize({ width: 390, height: 844 });
    await check('Studio fits a 390-pixel viewport without horizontal page overflow', async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.equal(await page.getByRole('navigation', { name: 'Studio navigation', exact: true }).isVisible(), false);
    });
    await check('Mobile navigation opens, traps focus, closes on Escape and restores its trigger', async () => {
      const trigger = page.getByRole('button', { name: 'Open Studio navigation', exact: true }); await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Studio navigation', exact: true }); await dialog.waitFor();
      assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
      await page.keyboard.press('Escape'); assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    });
    await capture({ path: path.join(artifacts, 'studio-newsroom-mobile.png'), fullPage: true });
    await check('Mobile assignment creation preserves text when closing is cancelled', async () => {
      await page.getByRole('button', { name: 'New assignment', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'New assignment', exact: true });
      await dialog.getByRole('textbox', { name: 'Assignment title', exact: true }).fill('Keep this assignment'); await page.keyboard.press('Escape');
      const discard = page.getByRole('dialog', { name: 'Discard assignment changes?', exact: true }); await discard.waitFor(); await discard.getByRole('button', { name: 'Keep editing', exact: true }).click();
      assert.equal(await dialog.getByRole('textbox', { name: 'Assignment title', exact: true }).inputValue(), 'Keep this assignment');
      const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await discard.getByRole('button', { name: 'Discard changes', exact: true }).click();
    });
    assert.deepEqual(errors, [], 'No browser runtime errors');
    await fs.writeFile(path.join(artifacts, 'browser-receipt.json'), JSON.stringify({ checkedAt: new Date().toISOString(), runtime: await browser.version(), scope: 'Actual Studio components with synthetic records and RPC adapters. This does not establish authenticated QA, Storage, provider, publishing-worker or physical-device acceptance.', checks: checks.map(name => ({ name, passed: true })), browserErrors: errors, screenshots: ['studio-overview-desktop.png', 'studio-ads-desktop.png', 'studio-insights-desktop.png', 'studio-newsroom-desktop.png', 'studio-partnerships-desktop.png', 'studio-earnings-desktop.png', 'studio-team-desktop.png', 'studio-newsroom-dark.png', 'studio-newsroom-mobile.png'] }, null, 2) + '\n');
    console.log(JSON.stringify({ passed: checks.length, browserErrors: errors.length, artifacts }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
