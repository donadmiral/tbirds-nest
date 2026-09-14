import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

// The four sizes every page must hold: a small phone, a common phone, a tablet and a laptop.
const SIZES = [
  { name: "phone-s", width: 375, height: 667 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
];

// Fixed routes. Routes with an id are discovered from the listing pages at run time.
const STATIC_ROUTES = [
  "/home", "/discover", "/explore", "/search", "/notifications", "/messages", "/messages/requests",
  "/market", "/market/new", "/market/saved", "/market/messages",
  "/jobs", "/jobs/new", "/jobs/saved", "/jobs/applications", "/jobs/messages",
  "/communities", "/channels", "/businesses", "/businesses/new", "/businesses/apply", "/ads", "/ads/new",
  "/saved", "/archive", "/calls", "/settings", "/settings/account-type", "/settings/activity", "/settings/archive",
  "/settings/blocked", "/settings/download", "/settings/follow-requests", "/settings/help", "/settings/hidden-words",
  "/settings/login-activity", "/settings/muted", "/settings/muted-words", "/settings/standing", "/settings/support",
  "/settings/two-factor", "/settings/username", "/settings/verification", "/about", "/privacy",
];
const DISCOVER: Array<{ from: string; prefix: string }> = [
  { from: "/home", prefix: "/post/" },
  { from: "/communities", prefix: "/communities/" },
  { from: "/channels", prefix: "/channels/" },
  { from: "/jobs", prefix: "/jobs/" },
  { from: "/market", prefix: "/market/" },
];

const ROOT = path.join(process.cwd(), "e2e");
const SHOTS = path.join(ROOT, "shots");
const PREV = path.join(ROOT, "shots-prev");
const REPORT = path.join(ROOT, "report");

type Row = {
  route: string; size: string; state: "idle" | "typing";
  file: string; overflowPx: number; offenders: string[];
  consoleErrors: string[]; failedRequests: string[]; diffRatio: number | null;
};

function safeName(route: string) { return route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_") || "root"; }

async function measure(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const overflowPx = Math.max(0, document.documentElement.scrollWidth - vw);
    const offenders: string[] = [];
    if (overflowPx > 1) {
      const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== "fixed") {
          const id = el.id ? "#" + el.id : "";
          const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
          offenders.push(el.tagName.toLowerCase() + id + cls + " (right " + Math.round(r.right) + "px)");
          if (offenders.length >= 6) break;
        }
      }
    }
    return { overflowPx, offenders };
  });
}

function diffAgainstPrev(file: string): number | null {
  const prev = path.join(PREV, path.relative(SHOTS, file));
  if (!fs.existsSync(prev)) return null;
  try {
    const a = PNG.sync.read(fs.readFileSync(prev));
    const b = PNG.sync.read(fs.readFileSync(file));
    if (a.width !== b.width || a.height !== b.height) return 1;
    const out = new PNG({ width: a.width, height: a.height });
    const changed = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.12 });
    return changed / (a.width * a.height);
  } catch { return null; }
}

test.describe.configure({ mode: "serial" });

test("every page holds at four widths, idle and while typing", async ({ browser }) => {
  test.setTimeout(90 * 60 * 1000);
  const email = process.env.E2E_EMAIL, password = process.env.E2E_PASSWORD;
  expect(email, "E2E_EMAIL is not set").toBeTruthy();
  expect(password, "E2E_PASSWORD is not set").toBeTruthy();

  // Rotate the last run's shots so this run can be diffed against them.
  if (fs.existsSync(SHOTS)) { fs.rmSync(PREV, { recursive: true, force: true }); fs.renameSync(SHOTS, PREV); }
  fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(REPORT, { recursive: true });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e.message).slice(0, 200)));
  page.on("response", (r) => { const u = r.url(); if (r.status() >= 400 && !/googleapis|gstatic|vercel|analytics/.test(u) && u.startsWith(page.url().split("/").slice(0, 3).join("/"))) failed.push(r.status() + " " + u.slice(0, 160)); });

  // Sign in once.
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const pass = page.locator('input[type="password"]').first();
  await pass.waitFor({ state: "visible", timeout: 60_000 });
  const user = page.locator('input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"], input[autocomplete="email"], input[type="text"]').first();
  await user.fill(email!);
  await pass.fill(password!);
  await pass.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

  // Discover one id-route per listing.
  const routes = [...STATIC_ROUTES];
  for (const d of DISCOVER) {
    await page.goto(d.from, { waitUntil: "networkidle" }).catch(() => {});
    const href = await page.locator(`a[href^="${d.prefix}"]`).first().getAttribute("href").catch(() => null);
    if (href && !routes.includes(href)) routes.push(href);
  }
  const me = await page.locator('a[href^="/"][aria-label*="rofile"], a[href^="/"]:has-text("Profile")').first().getAttribute("href").catch(() => null);
  if (me && /^\/[a-z0-9_.]+$/i.test(me) && !routes.includes(me)) routes.push(me);

  const rows: Row[] = [];
  for (const route of routes) {
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      consoleErrors.length = 0; failed.length = 0;
      await page.goto(route, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(600);
      const dir = path.join(SHOTS, size.name); fs.mkdirSync(dir, { recursive: true });
      const idleFile = path.join(dir, safeName(route) + ".png");
      await page.screenshot({ path: idleFile, fullPage: false });
      const m1 = await measure(page);
      rows.push({ route, size: size.name, state: "idle", file: idleFile, overflowPx: m1.overflowPx, offenders: m1.offenders, consoleErrors: [...consoleErrors], failedRequests: [...failed], diffRatio: diffAgainstPrev(idleFile) });

      // The keyboard state: focus the first visible text field and type, so composers and sticky bars show their raised layout.
      const field = page.locator('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):visible, textarea:visible, [contenteditable="true"]:visible').first();
      if (await field.count()) {
        try {
          await field.click({ timeout: 3_000 });
          await field.type("Alignment check", { delay: 5 });
          await page.waitForTimeout(300);
          const typingFile = path.join(dir, safeName(route) + "__typing.png");
          await page.screenshot({ path: typingFile, fullPage: false });
          const m2 = await measure(page);
          rows.push({ route, size: size.name, state: "typing", file: typingFile, overflowPx: m2.overflowPx, offenders: m2.offenders, consoleErrors: [...consoleErrors], failedRequests: [...failed], diffRatio: diffAgainstPrev(typingFile) });
        } catch { /* a field that cannot take text is not a layout fault */ }
      }
    }
  }

  // The report: one grid per route, four sizes across, idle and typing, flags in red.
  const flagged = rows.filter((r) => r.overflowPx > 1 || r.consoleErrors.length || r.failedRequests.length || (r.diffRatio !== null && r.diffRatio > 0.02));
  const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] as string));
  const byRoute = new Map<string, Row[]>();
  for (const r of rows) { if (!byRoute.has(r.route)) byRoute.set(r.route, []); byRoute.get(r.route)!.push(r); }
  let html = `<!doctype html><meta charset="utf-8"><title>Alignment proof</title>
<style>body{font:14px system-ui;margin:20px;color:#0B1E3D}h1{font-size:20px}h2{font-size:15px;margin:28px 0 8px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.cell{border:1px solid #e5e5ea;border-radius:10px;padding:8px;background:#fafaf9}
.cell img{width:100%;height:auto;border:1px solid #e5e5ea;background:#fff}.bad{border-color:#e0245e;background:#fff3f6}
.flag{color:#e0245e;font-size:12px;white-space:pre-wrap}.ok{color:#2f9e63;font-size:12px}.sum{padding:10px 12px;border-radius:10px;background:#f2f2f7;margin-bottom:12px}</style>
<h1>Alignment proof</h1><div class="sum">${rows.length} screenshots across ${byRoute.size} pages and ${SIZES.length} sizes. ${flagged.length ? '<b style="color:#e0245e">' + flagged.length + " flagged</b>" : '<b style="color:#2f9e63">Nothing flagged</b>'}. ${fs.existsSync(PREV) ? "Diffed against the previous run." : "First run: no previous shots to diff against."}</div>`;
  for (const [route, list] of byRoute) {
    html += `<h2>${esc(route)}</h2>`;
    for (const state of ["idle", "typing"] as const) {
      const cells = list.filter((r) => r.state === state);
      if (!cells.length) continue;
      html += `<div class="grid">`;
      for (const r of cells) {
        const bad = r.overflowPx > 1 || r.consoleErrors.length || r.failedRequests.length || (r.diffRatio !== null && r.diffRatio > 0.02);
        const rel = path.relative(REPORT, r.file).split(path.sep).join("/");
        html += `<div class="cell${bad ? " bad" : ""}"><div><b>${r.size}</b> · ${state}${r.diffRatio !== null ? " · changed " + (r.diffRatio * 100).toFixed(1) + "%" : ""}</div><a href="${rel}" target="_blank"><img src="${rel}" loading="lazy"></a>`;
        if (r.overflowPx > 1) html += `<div class="flag">Horizontal overflow ${r.overflowPx}px\n${esc(r.offenders.join("\n"))}</div>`;
        if (r.consoleErrors.length) html += `<div class="flag">Console: ${esc(r.consoleErrors.slice(0, 3).join("\n"))}</div>`;
        if (r.failedRequests.length) html += `<div class="flag">Requests: ${esc(r.failedRequests.slice(0, 3).join("\n"))}</div>`;
        if (!bad) html += `<div class="ok">Clean</div>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
  }
  fs.writeFileSync(path.join(REPORT, "index.html"), html);
  fs.writeFileSync(path.join(REPORT, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  await context.close();

  // The proof is the report; a flagged page fails the run so it cannot be missed.
  expect(flagged.map((r) => `${r.route} @ ${r.size} (${r.state})`), "flagged pages, open e2e/report/index.html").toEqual([]);
});
