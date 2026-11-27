import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { describe, expect, it } from "vitest";

import { AUTO_SIGNIN_KEY, authConfig, startSession } from "../src/index.ts";

const TENANT = "00000000-0000-0000-0000-0000000000aa";
const OPTIONS = { clientId: "spa-id", tenantId: TENANT, scope: "api://gate/portal.read", origin: "https://shell.test" };

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

function fakeClient(opts: {
  redirect?: unknown;
  redirectError?: Error;
  accounts?: unknown[];
  silent?: () => Promise<unknown>;
}) {
  const calls: string[] = [];
  let active: unknown = null;
  const client = {
    initialize: async () => void calls.push("initialize"),
    handleRedirectPromise: async () => {
      calls.push("handleRedirectPromise");
      if (opts.redirectError) throw opts.redirectError;
      return opts.redirect ?? null;
    },
    getActiveAccount: () => active,
    getAllAccounts: () => opts.accounts ?? [],
    setActiveAccount: (a: unknown) => {
      active = a;
    },
    loginRedirect: async (r: { scopes: string[]; prompt?: string }) =>
      void calls.push(`loginRedirect:${r.scopes}${r.prompt ? `:prompt=${r.prompt}` : ""}`),
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
    const { session, signIn } = await startSession({
      ...OPTIONS,
      autoSignIn: false,
      createClient: () => client as never,
    });
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

  // D87: session storage is per tab, so a fresh tab has no cached account.
  it("signs a fresh tab in without a click while the Entra session lives", async () => {
    const storage = memoryStorage();
    const fresh = fakeClient({});
    let settled = false;
    void startSession({ ...OPTIONS, storage, createClient: () => fresh.client as never }).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(fresh.calls).toEqual(["initialize", "handleRedirectPromise", "loginRedirect:api://gate/portal.read:prompt=none"]);
    expect(settled).toBe(false);
    expect(storage.items.get(AUTO_SIGNIN_KEY)).toBe("1");
    // Entra answers with the live session: the return page completes it, no Sign in page.
    const account = { homeAccountId: "a" };
    const back = fakeClient({ redirect: { account } });
    const { session } = await startSession({ ...OPTIONS, storage, createClient: () => back.client as never });
    expect(session?.account).toBe(account);
    expect(back.calls.some((c) => c.startsWith("loginRedirect"))).toBe(false);
  });

  it("shows the Sign in page when there is no Entra session, and never loops", async () => {
    const storage = memoryStorage();
    storage.setItem(AUTO_SIGNIN_KEY, "1");
    const refused = fakeClient({
      redirectError: new InteractionRequiredAuthError("login_required", "no session"),
    });
    const back = await startSession({ ...OPTIONS, storage, createClient: () => refused.client as never });
    expect(back.session).toBeNull();
    expect(refused.calls.some((c) => c.startsWith("loginRedirect"))).toBe(false);
    // The portal page the return page opens: still the Sign in page, no second redirect.
    const portal = fakeClient({});
    const again = await startSession({ ...OPTIONS, storage, createClient: () => portal.client as never });
    expect(again.session).toBeNull();
    expect(portal.calls).toEqual(["initialize", "handleRedirectPromise"]);
    await again.signIn();
    expect(portal.calls).toContain("loginRedirect:api://gate/portal.read");
  });

  it("keeps the Sign in page after an explicit sign-out", async () => {
    const storage = memoryStorage();
    const account = { homeAccountId: "a" };
    const signedIn = fakeClient({ accounts: [account] });
    const { session } = await startSession({ ...OPTIONS, storage, createClient: () => signedIn.client as never });
    await session?.signOut();
    expect(signedIn.calls).toContain("logoutRedirect");
    const after = fakeClient({});
    const out = await startSession({ ...OPTIONS, storage, createClient: () => after.client as never });
    expect(out.session).toBeNull();
    expect(after.calls).toEqual(["initialize", "handleRedirectPromise"]);
  });

  it("still surfaces a redirect error that no automatic attempt caused", async () => {
    const broken = fakeClient({ redirectError: new Error("state_mismatch") });
    await expect(
      startSession({ ...OPTIONS, storage: memoryStorage(), createClient: () => broken.client as never }),
    ).rejects.toThrow("state_mismatch");
  });
});
