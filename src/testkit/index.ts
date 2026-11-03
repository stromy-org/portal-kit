/**
 * Test kit for portal shells (Node only; never imported by browser code).
 *
 * - `startFakeGatekeeper`: an HTTP server that answers like the real gatekeeper
 *   (same paths, the same denial bytes, exact-origin CORS, private no-store),
 *   switched between scenarios so every degraded state can be driven end to end.
 * - `scanDist`: proves a built shell ships no data, no source maps, no secrets and no
 *   origin outside the allow-list, and refuses to pass on an empty build.
 * - `parseCsp` / `strictCspProblems`: read a policy and list what makes it weak.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, relative } from "node:path";

export const DENIED = '{"error":"denied"}';
export const UNAVAILABLE = '{"error":"unavailable"}';
export const INVALID = '{"error":"invalid"}';

export type Scenario = "ok" | "slow" | "unavailable" | "denied" | "error" | "expired" | "cold";

export interface Fixtures {
  nav: unknown;
  brand: unknown;
  profiles: Record<string, unknown>; // keyed "<engagement>/<period>"
  recipes: Record<string, (params: URLSearchParams, engagement: string, period: string) => unknown>;
}

export interface FakeGatekeeper {
  url: string;
  scenario: Scenario;
  slowMs: number;
  /** Requests answered, for asserting what the shell asked for. */
  log: Array<{ path: string; status: number; authorized: boolean }>;
  close(): Promise<void>;
}

export interface FakeOptions {
  fixtures: Fixtures;
  origin: string;
  token?: string;
  port?: number;
}

export async function startFakeGatekeeper(options: FakeOptions): Promise<FakeGatekeeper> {
  const token = options.token ?? "test-token";
  let coldLeft = 0;
  const state: FakeGatekeeper = {
    url: "",
    scenario: "ok",
    slowMs: 4000,
    log: [],
    close: async () => {},
  };
  const send = (req: IncomingMessage, res: ServerResponse, status: number, body: string | null) => {
    const headers: Record<string, string> = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    if (req.headers.origin === options.origin) headers["Access-Control-Allow-Origin"] = options.origin;
    if (body !== null) headers["Content-Type"] = "application/json";
    res.writeHead(status, headers);
    res.end(body ?? undefined);
  };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const authorized = req.headers.authorization === `Bearer ${token}`;
    const done = (status: number, body: string | null) => {
      state.log.push({ path: url.pathname, status, authorized });
      send(req, res, status, body);
    };
    if (url.pathname.startsWith("/__scenario/")) {
      state.scenario = url.pathname.slice("/__scenario/".length) as Scenario;
      coldLeft = state.scenario === "cold" ? 2 : 0;
      return done(204, null);
    }
    if (req.method === "OPTIONS") {
      if (req.headers.origin !== options.origin) return done(403, DENIED);
      res.writeHead(204, {
        "Access-Control-Allow-Origin": options.origin,
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Authorization",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      });
      state.log.push({ path: url.pathname, status: 204, authorized: false });
      return res.end();
    }
    if (req.headers.origin !== undefined && req.headers.origin !== options.origin) return done(403, DENIED);
    if (!authorized) return done(403, DENIED);
    const answer = () => {
      switch (state.scenario) {
        case "denied":
          return done(403, DENIED);
        case "unavailable":
          return done(503, UNAVAILABLE);
        case "error":
          return done(500, '{"error":"server"}');
        case "expired":
          return done(401, DENIED);
        case "cold":
          if (coldLeft > 0) {
            coldLeft -= 1;
            return done(503, UNAVAILABLE);
          }
      }
      const f = options.fixtures;
      if (url.pathname === "/portal/api/nav") return done(200, JSON.stringify(f.nav));
      if (url.pathname === "/portal/api/brand") return done(200, JSON.stringify(f.brand));
      const m = /^\/portal\/api\/e\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (!m) return done(403, DENIED);
      const [, engagement = "", period = "", artifact = ""] = m.map(decodeURIComponent);
      if (artifact === "profile") {
        const profile = f.profiles[`${engagement}/${period}`];
        return profile ? done(200, JSON.stringify(profile)) : done(403, DENIED);
      }
      if (!f.profiles[`${engagement}/${period}`]) return done(403, DENIED);
      const recipe = f.recipes[artifact];
      if (!recipe) return done(400, INVALID);
      return done(200, JSON.stringify(recipe(url.searchParams, engagement, period)));
    };
    if (state.scenario === "slow") setTimeout(answer, state.slowMs);
    else answer();
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  state.url = `http://127.0.0.1:${port}`;
  state.close = () => new Promise((resolve) => server.close(() => resolve()));
  return state;
}

export interface ScanOptions {
  /** Origins a built file may name (the shell, the gatekeeper, the sign-in host). */
  allowedOrigins: string[];
  /** Strings planted in fixtures that must never reach the build. */
  sentinels?: string[];
  /** A build with fewer files than this is treated as broken, not clean. */
  minFiles?: number;
  /** Data files allowed in the build (path suffixes). */
  allowedDataFiles?: string[];
}

const TEXT = /\.(html|js|mjs|css|json|txt|svg|xml|webmanifest)$/i;
const DATA = /\.(json|csv|ndjson|parquet|duckdb|sqlite)$/i;
const SECRET = [
  /client_secret/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
];
const ORIGIN = /\bhttps?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g;
// Standards namespaces that appear inside SVG and XML; never fetched.
const NAMESPACES = new Set(["http://www.w3.org", "https://www.w3.org"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function scanDist(dir: string, options: ScanOptions): string[] {
  const problems: string[] = [];
  const files = walk(dir);
  if (files.length < (options.minFiles ?? 3)) problems.push(`only ${files.length} files: the build is empty or broken`);
  const allowed = new Set([...options.allowedOrigins, ...NAMESPACES]);
  for (const file of files) {
    const rel = relative(dir, file);
    if (rel.endsWith(".map")) problems.push(`${rel}: source map in the build`);
    if (/(^|\/)\.env/.test(rel)) problems.push(`${rel}: environment file in the build`);
    if (DATA.test(rel) && !(options.allowedDataFiles ?? []).some((ok) => rel.endsWith(ok))) {
      problems.push(`${rel}: data file in the build`);
    }
    if (!TEXT.test(rel)) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes("sourceMappingURL=")) problems.push(`${rel}: sourceMappingURL`);
    for (const sentinel of options.sentinels ?? []) {
      if (text.includes(sentinel)) problems.push(`${rel}: fixture sentinel ${sentinel}`);
    }
    for (const pattern of SECRET) if (pattern.test(text)) problems.push(`${rel}: secret-shaped text ${pattern}`);
    for (const origin of text.match(ORIGIN) ?? []) {
      if (![...allowed].some((ok) => origin === ok || origin.startsWith(`${ok}/`))) {
        problems.push(`${rel}: origin ${origin} is not allowed`);
      }
    }
  }
  return [...new Set(problems)];
}

export type Csp = Map<string, string[]>;

export function parseCsp(policy: string): Csp {
  const csp: Csp = new Map();
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name && !csp.has(name.toLowerCase())) csp.set(name.toLowerCase(), values);
  }
  return csp;
}

/** Problems that make a header policy weaker than portal-shell.md decision 7 allows. */
export function strictCspProblems(policy: string, connect: string[]): string[] {
  const csp = parseCsp(policy);
  const problems: string[] = [];
  const all = [...csp.values()].flat();
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "*"]) {
    if (all.includes(bad)) problems.push(`policy allows ${bad}`);
  }
  const expect: Record<string, string[]> = {
    "default-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "frame-ancestors": ["'none'"],
  };
  for (const [directive, values] of Object.entries(expect)) {
    if (JSON.stringify(csp.get(directive)) !== JSON.stringify(values)) {
      problems.push(`${directive} must be ${values.join(" ")}`);
    }
  }
  const got = new Set(csp.get("connect-src") ?? []);
  const want = new Set(["'self'", ...connect]);
  if (got.size !== want.size || [...want].some((o) => !got.has(o))) {
    problems.push(`connect-src must be exactly ${[...want].join(" ")}`);
  }
  for (const directive of ["script-src", "style-src", "img-src", "font-src"]) {
    for (const value of csp.get(directive) ?? []) {
      if (/^https?:/.test(value)) problems.push(`${directive} allows a remote origin ${value}`);
    }
  }
  return problems;
}
