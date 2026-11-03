/**
 * Consumers compile this package from source out of node_modules, where their own
 * tsconfig does not apply: without a per-file pragma the bundler falls back to the
 * React JSX runtime and the consumer's build fails on `react/jsx-runtime`
 * (found rendering the portal-shell template, 2026-11-04). Every TSX source must
 * name its JSX runtime itself.
 */
// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { transformWithOxc } from "vite";

const SRC = join(import.meta.dirname, "..", "src");
const tsx = (readdirSync(SRC, { recursive: true }) as string[]).filter((p) => p.endsWith(".tsx"));

test("there are TSX sources to check", () => {
  expect(tsx.length).toBeGreaterThanOrEqual(3);
});

test.each(tsx)("%s declares the Preact JSX runtime", async (path) => {
  const code = readFileSync(join(SRC, path), "utf8");
  // Compile as a consumer would: no tsconfig, automatic runtime.
  const out = await transformWithOxc(code, join("/consumer/node_modules/@stromy/portal-kit/src", path), {
    lang: "tsx",
    jsx: { runtime: "automatic" },
  } as never);
  expect(out.code).toMatch(/from "preact\/jsx-runtime"/);
  expect(out.code).not.toMatch(/from "react\/jsx-runtime"/);
});
