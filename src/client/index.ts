/**
 * The gatekeeper client: one place that turns HTTP into the shell's error taxonomy.
 *
 * - The token comes from `getToken` on every call and is never stored here, put in a
 *   URL or logged.
 * - Only GETs exist, so only GETs are retried: on a cold start (503, 429, network,
 *   timeout) with exponential backoff and jitter, honouring Retry-After, within a
 *   total budget. A denial or an invalid request is never retried.
 * - A 401 asks the auth layer for a fresh token once; a second 401 is `auth`.
 */

import {
  type Brand,
  type Nav,
  type Profile,
  type RecipeResult,
  ContractError,
  parseBrand,
  parseNav,
  parseProfile,
  parseRecipe,
} from "../contract/index.ts";

export type FailureKind =
  | "denied" // 403 (and 404): never says whether the thing exists
  | "unavailable" // 503 after retries: no published release, or the service is waking
  | "invalid" // 400: the shell asked for something the gatekeeper does not serve
  | "auth" // 401 twice: the session must sign in again
  | "network"
  | "timeout"
  | "contract"; // the response did not match the contract

export class GatekeeperError extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly status?: number,
  ) {
    super(`gatekeeper ${kind}${status ? ` (${status})` : ""}`);
    this.name = "GatekeeperError";
  }
}

export interface ClientOptions {
  /** The gatekeeper origin, e.g. https://intel.example.com (no trailing slash). */
  baseUrl: string;
  /** Returns a current access token; `fresh` asks for one past the cache. */
  getToken: (fresh?: boolean) => Promise<string>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  /** The first call after load may meet a cold start: give it longer. */
  firstTimeoutMs?: number;
  retries?: number;
  retryBudgetMs?: number;
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function segment(value: string): string {
  if (!SEGMENT.test(value)) throw new GatekeeperError("invalid");
  return encodeURIComponent(value);
}

export class GatekeeperClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private first = true;

  constructor(private readonly options: ClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
  }

  nav(signal?: AbortSignal): Promise<Nav> {
    return this.get("/portal/api/nav", {}, signal).then(parseNav);
  }

  brand(signal?: AbortSignal): Promise<Brand> {
    return this.get("/portal/api/brand", {}, signal).then(parseBrand);
  }

  async profile(engagement: string, period: string, signal?: AbortSignal): Promise<Profile> {
    const path = `/portal/api/e/${segment(engagement)}/${segment(period)}/profile`;
    return this.get(path, {}, signal).then(parseProfile);
  }

  async recipe(
    engagement: string,
    period: string,
    key: string,
    params: Record<string, string | number | undefined> = {},
    signal?: AbortSignal,
  ): Promise<RecipeResult> {
    const path = `/portal/api/e/${segment(engagement)}/${segment(period)}/${segment(key)}`;
    return this.get(path, params, signal).then((body) => parseRecipe(body, key));
  }

  private async get(
    path: string,
    params: Record<string, string | number | undefined>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(path, this.options.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const retries = this.options.retries ?? 3;
    const budget = this.options.retryBudgetMs ?? 30_000;
    const started = Date.now();
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.once(url, refreshed, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        const kind = error instanceof GatekeeperError ? error.kind : "network";
        if (attempt < retries && Date.now() - started < budget) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new GatekeeperError(kind);
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new GatekeeperError("contract", response.status);
        }
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        continue;
      }
      if (RETRYABLE.has(response.status) && attempt < retries && Date.now() - started < budget) {
        await this.sleep(this.retryAfter(response) ?? this.backoff(attempt));
        continue;
      }
      throw new GatekeeperError(this.kindOf(response.status), response.status);
    }
  }

  private async once(url: URL, fresh: boolean, outer?: AbortSignal): Promise<Response> {
    const token = await this.options.getToken(fresh);
    const timeout = this.first
      ? (this.options.firstTimeoutMs ?? 30_000)
      : (this.options.timeoutMs ?? 15_000);
    this.first = false;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    outer?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    try {
      return await this.fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (error) {
      if (timedOut) throw new GatekeeperError("timeout");
      throw error;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    }
  }

  private backoff(attempt: number): number {
    const base = 1000 * 2 ** attempt;
    return base / 2 + this.random() * (base / 2);
  }

  private retryAfter(response: Response): number | undefined {
    const value = response.headers.get("retry-after");
    if (!value) return undefined;
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 30) * 1000 : undefined;
  }

  private kindOf(status: number): FailureKind {
    if (status === 401) return "auth";
    if (status === 403 || status === 404) return "denied";
    if (status === 400) return "invalid";
    return "unavailable";
  }
}

export { ContractError };
