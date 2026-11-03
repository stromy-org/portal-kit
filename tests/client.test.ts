import { describe, expect, it } from "vitest";

import { ContractError, GatekeeperClient, GatekeeperError, parseBrand, parseNav, parseRecipe } from "../src/index.ts";

const RECIPE = {
  key: "sov_by_theme",
  release_id: "rel_1",
  columns: [{ name: "theme", type: "VARCHAR" }],
  rows: [{ theme: "grid" }],
  caveats: [{ caveat_id: "cav_04", text: "Coverage is partial." }],
  params: { brief_id: "brf_sov" },
};

function reply(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function client(responses: Array<Response | Error>, extra: Partial<ConstructorParameters<typeof GatekeeperClient>[0]> = {}) {
  const calls: Array<{ url: string; auth: string | null; fresh: boolean }> = [];
  const sleeps: number[] = [];
  let fresh = false;
  const c = new GatekeeperClient({
    baseUrl: "https://gate.example.test",
    getToken: async (f) => {
      fresh = Boolean(f);
      return f ? "fresh-token" : "token";
    },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), auth: headers.get("authorization"), fresh });
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...extra,
  });
  return { c, calls, sleeps };
}

describe("contract", () => {
  it("accepts the gatekeeper's shapes and refuses drift", () => {
    expect(parseNav({ engagements: [{ engagement: "eng_1", period_id: null }] }).engagements[0]?.period_id).toBeNull();
    expect(() => parseNav({ engagements: [{ engagement: 3 }] })).toThrow(ContractError);
    expect(parseRecipe(RECIPE, "sov_by_theme").rows).toHaveLength(1);
    expect(() => parseRecipe(RECIPE, "movers")).toThrow(ContractError);
    expect(() => parseRecipe({ ...RECIPE, rows: [1] })).toThrow(ContractError);
    expect(() => parseRecipe({ ...RECIPE, caveats: [{ caveat_id: "x" }] })).toThrow(ContractError);
    expect(() => parseBrand({ display_name: null, colors: { primary: 3 }, fonts: {}, footer: "" })).toThrow(ContractError);
  });
});

describe("GatekeeperClient", () => {
  it("sends the token in the header only and builds encoded paths", async () => {
    const { c, calls } = client([reply(200, RECIPE)]);
    await c.recipe("eng_1", "2026-10", "sov_by_theme", { brief_id: "brf_sov", page: 2, skip: undefined });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.auth).toBe("Bearer token");
    expect(calls[0]?.url).toBe("https://gate.example.test/portal/api/e/eng_1/2026-10/sov_by_theme?brief_id=brf_sov&page=2");
    expect(calls[0]?.url).not.toContain("token");
  });

  it("refuses a malformed path segment before any request", async () => {
    const { c, calls } = client([]);
    await expect(c.profile("../etc", "2026-10")).rejects.toMatchObject({ kind: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("maps statuses to the failure taxonomy and never retries a denial", async () => {
    for (const [status, kind] of [
      [403, "denied"],
      [404, "denied"],
      [400, "invalid"],
    ] as const) {
      const { c, calls } = client([reply(status, { error: "x" })]);
      await expect(c.nav()).rejects.toMatchObject({ kind, status });
      expect(calls).toHaveLength(1);
    }
  });

  it("retries a cold start with backoff, honouring Retry-After, then succeeds", async () => {
    const { c, calls, sleeps } = client([reply(503, {}, { "Retry-After": "2" }), reply(503), reply(200, RECIPE)]);
    await expect(c.recipe("eng_1", "2026-10", "sov_by_theme")).resolves.toMatchObject({ key: "sov_by_theme" });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 1500]);
  });

  it("gives up as unavailable after its retries", async () => {
    const { c, calls } = client([reply(503), reply(503), reply(503), reply(503)]);
    await expect(c.nav()).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls).toHaveLength(4);
  });

  it("asks for a fresh token once on 401, then reports auth", async () => {
    const ok = client([reply(401), reply(200, { engagements: [] })]);
    await expect(ok.c.nav()).resolves.toEqual({ engagements: [] });
    expect(ok.calls.map((x) => x.auth)).toEqual(["Bearer token", "Bearer fresh-token"]);
    const twice = client([reply(401), reply(401)]);
    await expect(twice.c.nav()).rejects.toMatchObject({ kind: "auth" });
  });

  it("treats a network failure as retryable and a contract break as final", async () => {
    const { c } = client([new TypeError("offline"), reply(200, { engagements: [] })]);
    await expect(c.nav()).resolves.toEqual({ engagements: [] });
    const broken = client([reply(200, { nope: true })]);
    await expect(broken.c.nav()).rejects.toBeInstanceOf(ContractError);
  });

  it("times out a hung request", async () => {
    const { c } = client([], {
      retries: 0,
      firstTimeoutMs: 20,
      fetch: (_input, init) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    await expect(c.nav()).rejects.toEqual(new GatekeeperError("timeout"));
  });
});
