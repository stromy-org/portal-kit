import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { describe, expect, it } from "vitest";

import { authConfig, startSession } from "../src/index.ts";

const TENANT = "00000000-0000-0000-0000-0000000000aa";
const OPTIONS = { clientId: "spa-id", tenantId: TENANT, scope: "api://gate/portal.read", origin: "https://shell.test" };

function fakeClient(opts: { redirect?: unknown; accounts?: unknown[]; silent?: () => Promise<unknown> }) {
  const calls: string[] = [];
  let active: unknown = null;
  const client = {
    initialize: async () => void calls.push("initialize"),
    handleRedirectPromise: async () => {
      calls.push("handleRedirectPromise");
      return opts.redirect ?? null;
    },
    getActiveAccount: () => active,
    getAllAccounts: () => opts.accounts ?? [],
    setActiveAccount: (a: unknown) => {
      active = a;
    },
    loginRedirect: async (r: { scopes: string[] }) => void calls.push(`loginRedirect:${r.scopes}`),
    acquireTokenSilent: async (r: { forceRefresh: boolean }) => {
      calls.push(`silent:${r.forceRefresh}`);
      return (opts.silent ?? (async () => ({ accessToken: "at" })))();
    },
    acquireTokenRedirect: async () => void calls.push("acquireTokenRedirect"),
    logoutRedirect: async () => void calls.push("logoutRedirect"),
  };
  return { client, calls };
}

describe("auth", () => {
  it("pins the resource tenant, redirect flow and session storage", () => {
    const config = authConfig(OPTIONS);
    expect(config.auth.authority).toBe(`https://login.microsoftonline.com/${TENANT}`);
    expect(config.auth.redirectUri).toBe("https://shell.test/auth/");
    expect(config.cache?.cacheLocation).toBe("sessionStorage");
    expect(() => authConfig({ ...OPTIONS, tenantId: "common" })).toThrow(/GUID/);
  });

  it("initializes before anything else and asks to sign in when there is no account", async () => {
    const { client, calls } = fakeClient({});
    const { session, signIn } = await startSession({ ...OPTIONS, createClient: () => client as never });
    expect(session).toBeNull();
    expect(calls.slice(0, 2)).toEqual(["initialize", "handleRedirectPromise"]);
    await signIn();
    expect(calls).toContain("loginRedirect:api://gate/portal.read");
  });

  it("returns tokens silently, forces a refresh on request, and redirects on interaction_required", async () => {
    const account = { homeAccountId: "a" };
    const ok = fakeClient({ redirect: { account } });
    const { session } = await startSession({ ...OPTIONS, createClient: () => ok.client as never });
    expect(await session?.token()).toBe("at");
    await session?.token(true);
    expect(ok.calls).toContain("silent:true");
    const needs = fakeClient({
      accounts: [account],
      silent: async () => {
        throw new InteractionRequiredAuthError("interaction_required", "interaction needed");
      },
    });
    const started = await startSession({ ...OPTIONS, createClient: () => needs.client as never });
    void started.session?.token();
    await new Promise((r) => setTimeout(r, 0));
    expect(needs.calls).toContain("acquireTokenRedirect");
  });
});
