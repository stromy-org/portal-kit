import { describe, expect, it } from "vitest";

import { contrast, formatRoute, parseRoute, Router, safeTheme, applyTheme, type Theme } from "../src/index.ts";

const NEUTRAL: Theme = {
  colors: { primary: "#1f3a5f", accent: "#2f7d6d", ink: "#1b1f24", surface: "#ffffff", muted: "#5c6670" },
  fonts: { font_heading: "system-ui", font_body: "system-ui" },
};

describe("route codec", () => {
  it("round-trips a route and sorts its parameters", () => {
    const route = { engagement: "eng_1", period: "2026-10", view: "evidence", params: { page: "2", kind: "document" } };
    const href = formatRoute(route);
    expect(href).toBe("/app/eng_1/2026-10/evidence/?kind=document&page=2");
    const url = new URL(href, "https://shell.test");
    expect(parseRoute(url.pathname, url.search)).toEqual(route);
  });

  it("drops anything malformed instead of trusting it", () => {
    expect(parseRoute("/app/..%2f..%2fx/2026-10/evidence/", "")).toEqual({ params: {} });
    expect(parseRoute("/app/eng_1/2026-10/Evil View/", "").view).toBeUndefined();
    expect(parseRoute("/app/eng_1/2026-10/a/b/c/", "")).toEqual({ params: {} });
    const many = Array.from({ length: 20 }, (_, i) => `p${i}=1`).join("&");
    const params = parseRoute("/app/eng_1/2026-10/evidence/", `?${many}&BAD=1&x=${"y".repeat(300)}`).params;
    expect(Object.keys(params)).toHaveLength(12);
    expect(params).not.toHaveProperty("BAD");
    expect(parseRoute("/elsewhere/eng_1/", "")).toEqual({ params: {} });
  });
});

describe("router page-change contract", () => {
  it("resets scroll and focuses the h1 on push; restores scroll on back", () => {
    document.body.innerHTML = "<main><h1>Overview</h1></main>";
    window.history.replaceState({}, "", "/app/eng_1/2026-10/overview/");
    const seen: string[] = [];
    const announced: string[] = [];
    const scrolls: number[] = [];
    const original = window.scrollTo.bind(window);
    window.scrollTo = ((x: number, y: number) => {
      scrolls.push(y);
      original(x, y);
    }) as typeof window.scrollTo;
    const router = new Router({ onChange: (_r, how) => seen.push(how), announce: (m) => announced.push(m) });
    router.start();
    router.settled("Overview");
    Object.defineProperty(window, "scrollY", { value: 640, configurable: true });
    router.navigate({ engagement: "eng_1", period: "2026-10", view: "evidence", params: {} });
    router.settled("Evidence");
    expect(scrolls.at(-1)).toBe(0);
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.title).toBe("Evidence");
    router.settled("ignored");
    expect(announced).toEqual(["Overview", "Evidence"]);
    // Back: the saved 640 comes back only once the view says it has rendered.
    window.dispatchEvent(new PopStateEvent("popstate", { state: { portalY: 640 } }));
    expect(scrolls.at(-1)).toBe(0);
    router.settled("Overview");
    expect(scrolls.at(-1)).toBe(640);
    expect(seen).toEqual(["start", "push", "pop"]);
    router.stop();
    window.scrollTo = original;
  });
});

describe("theme", () => {
  it("computes WCAG contrast", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("keeps well-formed tokens and drops injections and low-contrast colours", () => {
    const theme = safeTheme(
      {
        display_name: "x",
        colors: { primary: "#123456", accent: "red;}body{x:1", ink: "#eeeeee", muted: "#444444" },
        fonts: { font_heading: "Inter, sans-serif", font_body: "x</style>" },
        footer: "Powered by Stromy",
      },
      NEUTRAL,
    );
    expect(theme.colors.primary).toBe("#123456");
    expect(theme.colors.accent).toBe(NEUTRAL.colors.accent);
    expect(theme.colors.ink).toBe(NEUTRAL.colors.ink); // #eee on white fails 4.5:1
    expect(theme.colors.muted).toBe("#444444");
    expect(theme.fonts).toEqual({ font_heading: "Inter, sans-serif", font_body: "system-ui" });
    expect(safeTheme(null, NEUTRAL)).toEqual(NEUTRAL);
  });

  it("applies tokens as custom properties, never as a style attribute string", () => {
    const root = document.createElement("div");
    applyTheme(safeTheme(null, NEUTRAL), root);
    expect(root.style.getPropertyValue("--pk-primary")).toBe("#1f3a5f");
    expect(root.style.getPropertyValue("--pk-font-heading")).toBe("system-ui");
  });
});
