// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DENIED, scanDist, startFakeGatekeeper, strictCspProblems } from "../src/testkit/index.ts";

const ORIGIN = "https://shell.example.test";
const GATE = "https://gate.example.test";
const LOGIN = "https://login.microsoftonline.com";

const STRICT =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  `connect-src 'self' ${GATE} ${LOGIN}; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'`;

function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pk-dist-"));
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

const CLEAN = {
  "index.html": `<html><body><svg xmlns="http://www.w3.org/2000/svg"></svg><a href="${LOGIN}/x">sign in</a></body></html>`,
  "_astro/app.js": `fetch("${GATE}/portal/api/nav")`,
  "_astro/app.css": "body{}",
  "staticwebapp.config.json": "{}",
};
const SCAN = { allowedOrigins: [ORIGIN, GATE, LOGIN], sentinels: ["FIXTURE-SENTINEL-7f3a"], allowedDataFiles: ["staticwebapp.config.json"] };

describe("scanDist", () => {
  it("passes a clean build", () => {
    expect(scanDist(dist(CLEAN), SCAN)).toEqual([]);
  });

  it("catches every class of leak (negative controls)", () => {
    const leaks: Record<string, string> = {
      "_astro/app.js.map": "{}",
      "_astro/leak.js": "const x = 'FIXTURE-SENTINEL-7f3a'; //# sourceMappingURL=x",
      "_astro/token.js": "h = 'Bearer abcdefghijklmnopqrstuvwxyz123456'",
      "_astro/cdn.js": "import('https://cdn.example.com/x.js')",
      "data/rows.json": "[]",
      ".env": "X=1",
    };
    const problems = scanDist(dist({ ...CLEAN, ...leaks }), SCAN).join("\n");
    for (const expected of ["source map", "fixture sentinel", "sourceMappingURL", "secret-shaped", "https://cdn.example.com", "data file", "environment file"]) {
      expect(problems).toContain(expected);
    }
  });

  it("flags a client secret value but not MSAL's protocol constant (found in a real shell build)", () => {
    // The exact shape a minified MSAL 5 bundle carries: the parameter NAME as a constant.
    const msal = { ...CLEAN, "_astro/runtime.js": "Ce=`post_logout_redirect_uri`,we=`id_token_hint`,Te=`client_secret`,Ee=`client_assertion`" };
    expect(scanDist(dist(msal), SCAN)).toEqual([]);
    const leaked = { ...CLEAN, "_astro/cfg.js": 'const c={"client_secret":"Abc8Q~xyz0123456789longvalue"}' };
    expect(scanDist(dist(leaked), SCAN).join("\n")).toContain("secret-shaped");
    const query = { ...CLEAN, "_astro/q.js": "u+'&client_secret=Abc8Q~xyz0123456789long'" };
    expect(scanDist(dist(query), SCAN).join("\n")).toContain("secret-shaped");
  });

  it("refuses an empty build instead of passing it", () => {
    expect(scanDist(dist({ "index.html": "" }), SCAN)[0]).toContain("empty or broken");
  });
});

describe("strictCspProblems", () => {
  it("accepts the portal-shell policy", () => {
    expect(strictCspProblems(STRICT, [GATE, LOGIN])).toEqual([]);
  });

  it("names each weakening (negative controls)", () => {
    expect(strictCspProblems(STRICT.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"), [GATE, LOGIN])).toContain(
      "policy allows 'unsafe-inline'",
    );
    expect(strictCspProblems(STRICT.replace("frame-ancestors 'none'", "frame-ancestors 'self'"), [GATE, LOGIN])).toContain(
      "frame-ancestors must be 'none'",
    );
    expect(strictCspProblems(STRICT.replace(` ${LOGIN};`, ";"), [GATE, LOGIN])[0]).toContain("connect-src must be exactly");
    expect(strictCspProblems(STRICT.replace("img-src 'self' data:", "img-src 'self' https://x.test"), [GATE, LOGIN])).toContain(
      "img-src allows a remote origin https://x.test",
    );
  });
});

describe("fake gatekeeper", () => {
  it("answers like the real one: same denial bytes, exact-origin CORS, no-store", async () => {
    const gate = await startFakeGatekeeper({
      origin: ORIGIN,
      fixtures: {
        nav: { engagements: [{ engagement: "eng_1", period_id: "2026-10" }] },
        brand: { display_name: null, colors: {}, fonts: {}, footer: "Powered by Stromy" },
        profiles: { "eng_1/2026-10": { release_id: "r", briefs: [] } },
        recipes: { sov_by_theme: () => ({ key: "sov_by_theme" }) },
      },
    });
    try {
      const auth = { Authorization: "Bearer test-token", Origin: ORIGIN };
      const ok = await fetch(`${gate.url}/portal/api/nav`, { headers: auth });
      expect(ok.status).toBe(200);
      expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      expect(ok.headers.get("cache-control")).toBe("private, no-store");
      for (const [path, headers] of [
        ["/portal/api/nav", { Origin: ORIGIN }],
        ["/portal/api/nav", { ...auth, Origin: "https://evil.test" }],
        ["/portal/api/e/eng_2/2026-10/profile", auth],
        ["/portal/api/e/eng_1/2099-01/sov_by_theme", auth],
      ] as const) {
        const denied = await fetch(`${gate.url}${path}`, { headers });
        expect([denied.status, await denied.text()]).toEqual([403, DENIED]);
      }
      expect((await fetch(`${gate.url}/portal/api/e/eng_1/2026-10/nope`, { headers: auth })).status).toBe(400);
      await fetch(`${gate.url}/__scenario/unavailable`);
      expect((await fetch(`${gate.url}/portal/api/nav`, { headers: auth })).status).toBe(503);
    } finally {
      await gate.close();
    }
  });
});
