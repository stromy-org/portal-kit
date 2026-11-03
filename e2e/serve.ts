/**
 * The e2e environment: the built demo served with the production-strength CSP
 * header (portal-shell.md decision 7) on :4400, and the fake gatekeeper on :4401.
 */

import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

import { FIXTURES } from "./fixtures.ts";
import { startFakeGatekeeper } from "../src/testkit/index.ts";

export const SHELL = "http://127.0.0.1:4400";
export const GATE = "http://127.0.0.1:4401";
export const LOGIN = "https://login.microsoftonline.com";
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  `connect-src 'self' ${GATE} ${LOGIN}; base-uri 'none'; form-action 'self'; object-src 'none'; ` +
  "frame-ancestors 'none'; manifest-src 'self'";

const DIST = join(import.meta.dirname, ".dist");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

await startFakeGatekeeper({ origin: SHELL, fixtures: FIXTURES, port: 4401 });

createServer((req, res) => {
  const url = new URL(req.url ?? "/", SHELL);
  let path = normalize(join(DIST, url.pathname));
  if (!path.startsWith(DIST)) path = join(DIST, "index.html");
  try {
    if (statSync(path).isDirectory()) path = join(path, "index.html");
  } catch {
    path = join(DIST, "index.html"); // the SPA fallback for /app/*
  }
  const body = readFileSync(path);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
    "Content-Security-Policy": CSP,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  res.end(body);
}).listen(4400, "127.0.0.1", () => console.log(`shell ${SHELL} gate ${GATE}`));
