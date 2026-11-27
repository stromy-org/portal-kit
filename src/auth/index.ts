/**
 * Sign-in glue over @azure/msal-browser 5 (portal-shell.md decision 5).
 *
 * - Redirect flow (no popup), auth code + PKCE, session storage.
 * - The authority is the resource tenant, so B2B guests sign in there.
 * - One delegated scope on the gatekeeper's audience.
 * - One silent attempt, then a redirect; errors are branched on `errorCode`.
 * - The access token is fetched per call and never kept by the shell.
 * - A fresh tab signs in without a click (ORG-PLAN-369 D87): session storage is per
 *   tab, so a new tab starts with no cached account. While the Entra session lives,
 *   one `prompt=none` redirect per tab brings the account back with no prompt. If
 *   Entra needs an interaction (no session, several accounts, consent), the tab lands
 *   on the Sign in page; the tab never tries on its own a second time, so nothing
 *   can loop. Signing out also stops it, so a real signed-out state keeps its Sign in page.
 */

import {
  type AccountInfo,
  type Configuration,
  InteractionRequiredAuthError,
  type IPublicClientApplication,
  PromptValue,
  PublicClientApplication,
} from "@azure/msal-browser";

export interface AuthOptions {
  clientId: string;
  /** The resource tenant id (never `common` or `organizations`). */
  tenantId: string;
  /** e.g. api://<gatekeeper-app>/portal.read */
  scope: string;
  /** Same-origin page registered under the SPA platform, e.g. "/auth/". */
  redirectPath?: string;
  origin?: string;
  /** Tests inject a fake; production builds the real client. */
  createClient?: (config: Configuration) => IPublicClientApplication;
  /** Sign a fresh tab in without a click while the Entra session lives (default true). */
  autoSignIn?: boolean;
  /** Where the once-per-tab marker lives (default `sessionStorage`); tests inject one. */
  storage?: Pick<Storage, "getItem" | "setItem">;
}

export interface Session {
  account: AccountInfo;
  token(fresh?: boolean): Promise<string>;
  signOut(): Promise<void>;
}

const TENANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authConfig(options: AuthOptions): Configuration {
  if (!TENANT.test(options.tenantId)) {
    throw new Error("tenantId must be the resource tenant's GUID");
  }
  const origin = options.origin ?? globalThis.location.origin;
  return {
    auth: {
      clientId: options.clientId,
      authority: `https://login.microsoftonline.com/${options.tenantId}`,
      redirectUri: origin + (options.redirectPath ?? "/auth/"),
      postLogoutRedirectUri: origin + "/signed-out/",
      navigateToLoginRequestUrl: false,
    },
    cache: { cacheLocation: "sessionStorage" },
  } as Configuration;
}

/** The per-tab marker: an automatic sign-in was tried (or the person signed out). */
export const AUTO_SIGNIN_KEY = "pk.auth.auto-signin";

function tabStorage(options: AuthOptions): Pick<Storage, "getItem" | "setItem"> | null {
  if (options.storage) return options.storage;
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Starts the session: completes a pending redirect, or returns null when the
 * person still has to sign in (call `signIn`). With no cached account and no
 * automatic attempt yet in this tab, it redirects with `prompt=none` instead and
 * the returned promise never settles (the page navigates away).
 */
export async function startSession(options: AuthOptions): Promise<{
  session: Session | null;
  signIn: () => Promise<void>;
}> {
  const config = authConfig(options);
  const client = (options.createClient ?? ((c) => new PublicClientApplication(c)))(config);
  const storage = tabStorage(options);
  const attempted = () => storage?.getItem(AUTO_SIGNIN_KEY) != null;
  await client.initialize();
  let result: Awaited<ReturnType<IPublicClientApplication["handleRedirectPromise"]>> = null;
  try {
    result = await client.handleRedirectPromise();
  } catch (error) {
    // The automatic attempt came back refused (login_required, interaction_required,
    // consent_required …): that is the signed-out state, never an error screen.
    if (!attempted()) throw error;
  }
  const account = result?.account ?? client.getActiveAccount() ?? client.getAllAccounts()[0];
  const scopes = [options.scope];
  const signIn = () => client.loginRedirect({ scopes });
  if (!account) {
    if (options.autoSignIn !== false && storage && !attempted()) {
      storage.setItem(AUTO_SIGNIN_KEY, "1");
      await client.loginRedirect({ scopes, prompt: PromptValue.NONE });
      // The page navigates away; this promise never settles in a browser.
      return new Promise(() => {});
    }
    return { session: null, signIn };
  }
  // The marker stays: one automatic attempt per tab, so no failure can loop. A later
  // expiry in a signed-in tab goes through `token()`'s own redirect.
  client.setActiveAccount(account);
  const session: Session = {
    account,
    async token(fresh = false) {
      try {
        const silent = await client.acquireTokenSilent({ scopes, account, forceRefresh: fresh });
        return silent.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          await client.acquireTokenRedirect({ scopes, account });
          // The page navigates away; this promise never settles in a browser.
          return new Promise<string>(() => {});
        }
        throw error;
      }
    },
    signOut: () => {
      // A person who signed out sees the Sign in page in this tab, not a silent return.
      storage?.setItem(AUTO_SIGNIN_KEY, "signed-out");
      return client.logoutRedirect({ account });
    },
  };
  return { session, signIn };
}
