/**
 * Sign-in glue over @azure/msal-browser 5 (portal-shell.md decision 5).
 *
 * - Redirect flow (no popup), auth code + PKCE, session storage.
 * - The authority is the resource tenant, so B2B guests sign in there.
 * - One delegated scope on the gatekeeper's audience.
 * - One silent attempt, then a redirect; errors are branched on `errorCode`.
 * - The access token is fetched per call and never kept by the shell.
 */

import {
  type AccountInfo,
  type Configuration,
  InteractionRequiredAuthError,
  type IPublicClientApplication,
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

/**
 * Starts the session: completes a pending redirect, or returns null when the
 * person still has to sign in (call `signIn`).
 */
export async function startSession(options: AuthOptions): Promise<{
  session: Session | null;
  signIn: () => Promise<void>;
}> {
  const config = authConfig(options);
  const client = (options.createClient ?? ((c) => new PublicClientApplication(c)))(config);
  await client.initialize();
  const result = await client.handleRedirectPromise();
  const account = result?.account ?? client.getActiveAccount() ?? client.getAllAccounts()[0];
  const scopes = [options.scope];
  const signIn = () => client.loginRedirect({ scopes });
  if (!account) return { session: null, signIn };
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
    signOut: () => client.logoutRedirect({ account }),
  };
  return { session, signIn };
}
