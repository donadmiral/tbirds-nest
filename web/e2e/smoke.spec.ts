/**
 * The walk a person takes every day, as a test: sign in, feed, a post,
 * search, notifications, and every settings page. Any thrown page error,
 * any 5xx response, or any console error fails the screen it happened on.
 * A screenshot of each screen lands in e2e-screens/ for the eye.
 */
import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";

const EMAIL = process.env.E2E_EMAIL || "";
const PASSWORD = process.env.E2E_PASSWORD || "";
const SHOTS = "e2e-screens";
fs.mkdirSync(SHOTS, { recursive: true });

function watch(page: Page, problems: string[]) {
  page.on("pageerror", (e) => problems.push("page error: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push("console: " + m.text().slice(0, 200)); });
  page.on("response", async (r) => { if (r.status() >= 400 && r.status() !== 401 && r.status() !== 403 && r.status() !== 404) { let body = ""; try { body = (await r.text()).slice(0, 200); } catch {} problems.push("server " + r.status() + " on " + r.url().slice(0, 160) + " :: " + body); } });
}

async function visit(page: Page, path: string, name: string, problems: string[]) {
  problems.length = 0;
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(res, name + " loaded").not.toBeNull();
  expect(res!.status(), name + " status").toBeLessThan(400);
  await page.waitForLoadState("load").catch(() => {}); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  expect(problems, name + " problems").toEqual([]);
}

test.describe("Platinum Circles web smoke", () => {
  test.setTimeout(600_000);
  test("signs in and walks the app", async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, "E2E_EMAIL and E2E_PASSWORD are required");
    const problems: string[] = [];
    watch(page, problems);

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const id = page.getByPlaceholder(/username or email/i).first();
    await expect(id, 'login form visible').toBeVisible({ timeout: 20_000 });
    await id.fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    const authResponse = page.waitForResponse((r) => r.url().includes("/auth/v1/token") || r.url().includes("sign-in-with-username"), { timeout: 30_000 }).then(async (r) => "auth " + r.status() + " " + (await r.text()).slice(0, 300)).catch(() => "auth request never sent");
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click();
    console.log(await authResponse);
    const left = page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }).then(() => "left");
    const errored = page.locator("p.text-danger").filter({ hasText: /\S/ }).first().waitFor({ state: "visible", timeout: 30_000 }).then(async () => "error: " + (await page.locator("p.text-danger").filter({ hasText: /\S/ }).first().innerText())).catch(() => new Promise<string>(() => {}));
    const outcome = await Promise.race([left, errored]);
    expect(outcome, "sign-in outcome").toBe("left");
    await page.screenshot({ path: `${SHOTS}/00-after-login.png` });
    expect(problems, "login problems").toEqual([]);

    await visit(page, "/home", "01-home", problems);
    const firstPost = page.locator('a[href^="/p/"]').first();
    if (await firstPost.count()) {
      const href = await firstPost.getAttribute("href");
      await visit(page, href!, "02-post", problems);
    }
    await visit(page, "/search", "03-search", problems);
    await visit(page, "/notifications", "04-notifications", problems);
    await visit(page, "/messages", "05-messages", problems);
    await visit(page, "/settings", "06-settings", problems);
    for (const [path, name] of [
      ["/settings/account-type", "07-account-type"], ["/settings/verification", "08-verification"], ["/settings/hidden-words", "09-hidden-words"],
      ["/settings/muted-words", "10-muted-words"], ["/settings/two-factor", "11-two-factor"], ["/settings/login-activity", "12-login-activity"],
      ["/settings/archive", "13-archive"], ["/settings/activity", "14-activity"], ["/settings/download", "15-download"],
      ["/settings/follow-requests", "16-follow-requests"], ["/settings/blocked", "17-blocked"], ["/settings/muted", "18-muted"],
    ]) { await visit(page, path, name, problems); }
    await visit(page, "/studio", "19-studio", problems);
    await visit(page, "/explore", "20-explore", problems);
  });
});