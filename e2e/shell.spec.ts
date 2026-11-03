import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { scanDist, strictCspProblems } from "../src/testkit/index.ts";
import { SENTINEL } from "./fixtures.ts";

const GATE = "http://127.0.0.1:4401";
const LOGIN = "https://login.microsoftonline.com";

async function scenario(name: string) {
  await fetch(`${GATE}/__scenario/${name}`);
}

/** Records every CSP violation the page raises, from the first script on. */
async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(msg.text())) violations.push(msg.text());
  });
  await page.exposeFunction("__pkViolation", (v: string) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { __pkViolation: (v: string) => void }).__pkViolation(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return violations;
}

test.beforeEach(async () => {
  await scenario("ok");
});

test("the shell runs under the strict CSP with zero violations, and themes at runtime", async ({ page }) => {
  const violations = await watchCsp(page);
  const response = await page.goto("/app/");
  expect(strictCspProblems(response?.headers()["content-security-policy"] ?? "", [GATE, LOGIN])).toEqual([]);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.locator("svg[role=img]")).toHaveAttribute("aria-label", /highest is Grid capacity at 42%/);
  await expect(page.getByText("Sample data for the kit's tests.")).toBeVisible();
  const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--pk-primary").trim());
  expect(primary).toBe("#5a2d82");
  await page.getByRole("link", { name: "Evidence" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Page 2 of 3")).toBeVisible();
  expect(violations).toEqual([]);
});

test("a forward navigation resets scroll and focuses the h1; back restores it", async ({ page }) => {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  // A script click: Playwright's own click would scroll the link into view first.
  await page.getByRole("link", { name: "Evidence" }).evaluate((a: HTMLElement) => a.click());
  await expect(page.getByRole("heading", { level: 1, name: "Evidence" })).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page).toHaveTitle("Evidence");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
});

for (const [name, text] of [
  ["unavailable", "Nothing has been published for this period yet."],
  ["denied", "You do not have access to this view."],
] as const) {
  test(`a ${name} release shows its state in words, never a number`, async ({ page }) => {
    await page.goto("/app/eng_demo/2026-10/overview/");
    await scenario(name);
    await page.reload();
    await expect(page.getByText(text)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("svg[role=img]")).toHaveCount(0);
  });
}

test("a cold start is retried until the service answers", async ({ page }) => {
  await scenario("cold");
  await page.goto("/app/eng_demo/2026-10/overview/");
  await expect(page.locator("svg[role=img]")).toBeVisible({ timeout: 20_000 });
});

test("axe finds no WCAG 2.2 AA violation on either view", async ({ page }) => {
  for (const view of ["overview", "evidence"]) {
    await page.goto(`/app/eng_demo/2026-10/${view}/`);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator(".pk-panel[data-state=ready]")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`), view).toEqual([]);
  }
});

test("the built shell ships no data, maps or foreign origins", () => {
  const problems = scanDist(join(import.meta.dirname, ".dist"), {
    allowedOrigins: [GATE, LOGIN, "http://127.0.0.1:4400"],
    sentinels: [SENTINEL, "Demo Tenant", "eng_demo"],
    minFiles: 3,
  });
  expect(problems).toEqual([]);
});
