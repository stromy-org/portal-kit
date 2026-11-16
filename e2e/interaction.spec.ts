/**
 * The interaction layer (ORG-PLAN-605 KIT, AC2) on the built demo, served with the
 * production-strength CSP header: hover, focus and touch cards; legend toggles; d3-zoom
 * and d3-brush with their keyboard equivalents; axe; zero CSP violations. Negative
 * controls: an inline style and an eval are reported, and a brush that cannot take the
 * pointer fails the brush assertion.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

const GATE = "http://127.0.0.1:4401";
const VIEW = "/app/eng_demo/2026-10/interaction/";

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

const card = (figure: Locator) => figure.locator(".pk-tip");
const bars = (page: Page) => page.locator("figure.pk-chart", { has: page.getByText("Share of statements by theme", { exact: true }) });
const lines = (page: Page) => page.locator("figure.pk-chart", { has: page.getByText("Documents per week", { exact: true }) }).first();

/** Drag across the middle of the line chart's plot; returns what the range output says. */
async function brushAcross(page: Page): Promise<string> {
  const svg = lines(page).locator("svg[role=img]");
  await svg.scrollIntoViewIfNeeded();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  return (await lines(page).locator("[data-range-out]").textContent()) ?? "";
}

test.beforeEach(async () => {
  await fetch(`${GATE}/__scenario/ok`);
});

test("cards open on hover and keyboard focus, say count, unit and denominator, and hide suppressed figures", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto(VIEW);
  await expect(page.getByRole("heading", { level: 1, name: "Interaction" })).toBeVisible();
  const fig = bars(page);
  await fig.locator(".pk-mark").nth(1).hover();
  await expect(card(fig)).toBeVisible();
  await expect(card(fig)).toHaveText(/PricesValue: 31%Count: 15Unit: share of statementsOut of: all statements on the demo briefOne outlet only\./);
  // The card sits beside its bar: inside the figure.
  const [c, f] = [await card(fig).boundingBox(), await fig.boundingBox()];
  expect(c!.y).toBeGreaterThanOrEqual(f!.y);
  expect(c!.x).toBeGreaterThanOrEqual(f!.x - 1);
  expect(c!.x + c!.width).toBeLessThanOrEqual(f!.x + f!.width + 1);
  await page.mouse.move(0, 0);
  await expect(card(fig)).toHaveText("");
  // Keyboard: the plot is a tab stop; arrows step; Escape closes.
  await fig.locator(".pk-plot").focus();
  await page.keyboard.press("ArrowRight");
  await expect(card(fig)).toContainText("Grid capacity");
  await page.keyboard.press("End");
  await expect(card(fig)).toHaveText(/Demo nicheNot shown: fewer than 10 statements/);
  await expect(fig).not.toContainText("88");
  await page.keyboard.press("Escape");
  await expect(card(fig)).toHaveText("");
  expect(violations).toEqual([]);
});

test.describe("touch", () => {
  test.use({ hasTouch: true });
  test("a tap opens a card", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", "Playwright's desktop Firefox has no touch emulation");
    await page.goto(VIEW);
    const fig = bars(page);
    await fig.locator(".pk-mark").first().tap();
    await expect(card(fig)).toContainText("Grid capacityValue: 42%Count: 21");
  });
});

test("legend toggles hide and show a series; the table keeps every row", async ({ page }) => {
  await page.goto(VIEW);
  const fig = lines(page);
  await expect(fig.locator("path.pk-line")).toHaveCount(2);
  const prices = fig.getByRole("button", { name: /^Prices/ });
  await expect(prices).toHaveAttribute("aria-pressed", "true");
  await prices.click();
  await expect(prices).toHaveAttribute("aria-pressed", "false");
  await expect(fig.locator("path.pk-line")).toHaveCount(1);
  await expect(fig.locator("details tbody tr")).toHaveCount(16);
  await prices.click();
  await expect(fig.locator("path.pk-line")).toHaveCount(2);
  const barFig = bars(page);
  await barFig.getByRole("button", { name: /^Small themes/ }).click();
  await expect(barFig.locator("svg[role=img] .pk-mark")).toHaveCount(2);
});

test("the brush selects a range by pointer and keyboard; zoom fits it, resets, and leaves the page scroll alone", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto(VIEW);
  const fig = lines(page);
  const zoom = () => fig.locator("svg[role=img]").getAttribute("data-zoom");
  const text = await brushAcross(page);
  expect(text).toMatch(/^2026-\d\d-\d\d to 2026-\d\d-\d\d \(\d+ dates\)$/);
  await expect(page.locator("[data-range-picked]")).toHaveText(/^Picked 2026-/);
  // The drawn range is the kit's own snapped rect; the d3 brush is cleared after the gesture.
  await expect(fig.locator("rect.pk-range")).toHaveCount(1);
  expect(await zoom()).toBe("1.00");
  await fig.getByRole("button", { name: "Zoom to range" }).click();
  await expect.poll(async () => Number(await zoom())).toBeGreaterThan(1.5);
  await fig.getByRole("button", { name: "Reset view" }).click();
  await expect.poll(zoom).toBe("1.00");
  // Keyboard: + on the plot zooms, 0 resets; the sliders move the range.
  await fig.locator(".pk-plot").focus();
  await page.keyboard.press("+");
  await expect.poll(async () => Number(await zoom())).toBeGreaterThan(1.2);
  await page.keyboard.press("0");
  await expect.poll(zoom).toBe("1.00");
  await fig.getByRole("button", { name: "Clear range" }).click();
  await expect(fig.locator("[data-range-out]")).toHaveText("No range selected");
  await fig.getByRole("slider", { name: "From" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(fig.locator("[data-range-out]")).toHaveText("2026-09-21 to 2026-10-26 (6 dates)");
  // A plain wheel scrolls the page and does not zoom; ctrl-wheel zooms.
  const svg = fig.locator("svg[role=img]");
  await svg.scrollIntoViewIfNeeded();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  expect(await zoom()).toBe("1.00");
  await svg.scrollIntoViewIfNeeded();
  const box2 = (await svg.boundingBox())!;
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect.poll(async () => Number(await zoom())).toBeGreaterThan(1);
  // The pointer card on the line chart: nearest point.
  await page.mouse.move(box2.x + box2.width * 0.3, box2.y + box2.height * 0.5);
  await expect(card(fig)).toContainText("Value:");
  expect(violations).toEqual([]);
});

test("the story timeline zooms and pans", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto(VIEW);
  const fig = page.locator("figure.pk-visual", { has: page.getByText("Demo story timeline", { exact: true }) });
  const zoom = () => fig.locator("svg").first().getAttribute("data-zoom");
  expect(await zoom()).toBe("1.00");
  await fig.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(async () => Number(await zoom())).toBeGreaterThan(1.3);
  await fig.getByRole("button", { name: "Reset view" }).click();
  await expect.poll(zoom).toBe("1.00");
  await fig.locator(".pk-plot").focus();
  await page.keyboard.press("ArrowRight");
  await expect(card(fig)).toContainText("Unit: documents");
  expect(violations).toEqual([]);
});

test("axe passes with every rule, cards open and tables open", async ({ page }) => {
  await page.goto(VIEW);
  await expect(page.locator("figure.pk-chart").first()).toBeVisible();
  const first = await new AxeBuilder({ page }).analyze();
  expect(first.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await bars(page).locator(".pk-plot").focus();
  await page.keyboard.press("ArrowRight");
  await page.locator("details > summary").evaluateAll((els) => els.forEach((e) => ((e.parentElement as HTMLDetailsElement).open = true)));
  const open = await new AxeBuilder({ page }).analyze();
  expect(open.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("negative control: an inline style and an eval on the interaction page ARE reported", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto(VIEW);
  await expect(bars(page)).toBeVisible();
  await page.evaluate(() => document.querySelector(".pk-plot")!.setAttribute("style", "color: red"));
  await expect.poll(() => violations.length).toBeGreaterThan(0);
  const afterStyle = violations.length;
  // A string timer is compiled by the page itself, so the page's CSP judges it (an eval
  // inside page.evaluate is not checked by every engine).
  await page.evaluate(() => {
    (setTimeout as unknown as (code: string, ms: number) => number)("window.__pkEvaled = 1", 0);
  });
  await expect.poll(() => violations.length).toBeGreaterThan(afterStyle);
  expect(violations.some((v) => /eval/i.test(v))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __pkEvaled?: number }).__pkEvaled)).toBeUndefined();
});

test("negative control: a brush that cannot take the pointer fails the brush assertion", async ({ page }) => {
  await page.goto(`${VIEW}?broken=brush`);
  await expect(lines(page)).toBeVisible();
  const text = await brushAcross(page);
  // The positive test's assertion would fail on this page.
  expect(text).not.toMatch(/^2026-\d\d-\d\d to 2026-\d\d-\d\d/);
  expect(text).toBe("No range selected");
});
