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

test("the rich visuals pass axe, raise no CSP violation, answer the keyboard and ship their tables", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto("/app/eng_demo/2026-10/visuals/");
  await expect(page.getByRole("heading", { level: 1, name: "Visuals" })).toBeVisible();
  await expect(page.locator("figure.pk-visual")).toHaveCount(6);
  // Keyboard: Tab to a matrix row and press Enter.
  const actor = page.getByRole("button", { name: "Actor Demo Operator: open details" });
  await actor.focus();
  await expect(actor).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-picked]")).toHaveText("a");
  await page.getByRole("button", { name: "Issue Demo tariffs: open details" }).click();
  await expect(page.locator("[data-picked]")).toHaveText("a · i1");
  await page.getByRole("button", { name: /Demo decision postponed: open details/ }).click();
  await expect(page.locator("[data-picked]")).toContainText("s1");
  // Every figure has its table fallback, and the hemicycle draws all 110 seats.
  await expect(page.locator("figure.pk-visual details table")).toHaveCount(6);
  expect(await page.locator("figure.pk-visual").nth(4).locator("svg[role=img] > circle, svg[role=img] > rect, svg[role=img] > polygon").count()).toBe(110);
  // Every axe rule, not only the WCAG tags: a mark's name must contain its visible text.
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  // Open every table: still no violation (the tables are real tables).
  await page.locator("details > summary").evaluateAll((els) => els.forEach((e) => (e.parentElement as HTMLDetailsElement).open = true));
  const again = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(again.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  expect(violations).toEqual([]);
});

test("the network graph zooms, pans, selects and fades under the strict CSP", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto("/app/eng_demo/2026-10/visuals/");
  const graph = page.locator("figure.pk-network");
  await expect(graph).toBeVisible();
  const zoom = () => graph.locator("svg > g[data-zoom]").getAttribute("data-zoom");
  const transform = () => graph.locator("svg > g[data-zoom]").getAttribute("transform");
  expect(await zoom()).toBe("1.00");
  await graph.getByRole("button", { name: "Zoom in" }).click();
  expect(Number(await zoom())).toBeGreaterThan(1.3);
  await graph.getByRole("button", { name: "Reset view" }).click();
  expect(await zoom()).toBe("1.00");
  const before = await transform();
  const svg = graph.locator("svg.pk-network__svg");
  await svg.focus();
  await page.keyboard.press("ArrowLeft");
  expect(await transform()).not.toBe(before);
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 70);
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => Number(await zoom())).toBeGreaterThan(1);
  // Selecting a node fades the nodes outside its neighbourhood.
  await graph.getByRole("button", { name: /^Actor Demo Party/ }).click();
  await expect(graph.getByRole("button", { name: /^Actor Demo Operator/ })).toHaveClass(/pk-faded/);
  await expect(graph.getByRole("button", { name: /^Issue Demo tariffs/ })).not.toHaveClass(/pk-faded/);
  expect(violations).toEqual([]);
});

test("negative control: an inline style IS reported on the visuals page, so the watcher can see a violation", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto("/app/eng_demo/2026-10/visuals/");
  await expect(page.locator("figure.pk-network")).toBeVisible();
  await page.evaluate(() => document.querySelector("figure.pk-network")!.setAttribute("style", "color: red"));
  await expect.poll(() => violations.length).toBeGreaterThan(0);
});
