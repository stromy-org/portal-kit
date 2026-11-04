# Changelog

All notable changes to `@stromy/portal-kit`. Each release is a tag cut by `release.yml`
from the `version` in `package.json`.

## v0.1.3 — 2026-11-04

- `PanelFrame` caveat notes are no longer an `<aside>` landmark. A portal page shows many
  panels, and each one carrying caveats added a complementary landmark named "Notes", so
  axe failed the page on `landmark-unique` (found on the first portal's pages). The notes
  are a plain block with their heading; pinned by a test that fails on the old markup.

## v0.1.2 — 2026-11-04

Found by rendering the first portal-shell satellite against the kit:

- `@types/d3-scale` and `@types/d3-shape` are now dependencies, not devDependencies.
  Consumers type-check the kit's TypeScript source, so its type imports are part of its
  public surface; without them a consumer's `tsc` failed on `charts/index.tsx`.
- `scanDist` flags a `client_secret` VALUE (`client_secret=...`, `"client_secret":"..."`),
  no longer the bare word: every real shell bundles MSAL, which names `client_secret` as a
  protocol constant, so the old pattern failed every production build. Test built from
  the exact minified MSAL 5 shape; negative control: the old pattern turns it red.

## v0.1.1 — 2026-11-04

- Every TSX source now names its JSX runtime (`@jsxImportSource preact`). Consumers
  compile the kit from `node_modules`, where their own tsconfig does not apply, so the
  bundler fell back to React's runtime and the consumer build failed on
  `react/jsx-runtime`. Found rendering the portal-shell template; pinned by
  `tests/consumer-jsx.test.ts`, which compiles each file as a consumer would.
- `scripts/premerge-verify.sh`: the merged-tree verifier (org-core, generated agent
  files, version agreement, `npm ci`, typecheck, unit tests).

## v0.1.0 — 2026-11-04

First release (ORG-PLAN-369 P-KIT; design in stromy-org
`plans/ORG-PLAN-369_client-intelligence-platform/portal-shell.md`).

- `contract`: the gatekeeper's nav, brand, profile and recipe shapes, validated at runtime
  by hand-written validators (no eval-probing schema library).
- `client`: `GatekeeperClient` with the token in the header only, GET-only retries with
  jitter and Retry-After, timeouts (longer for the first, cold-start call) and the failure
  taxonomy (denied, unavailable, invalid, auth, network, timeout, contract).
- `auth`: MSAL 5 redirect flow with session storage, the resource tenant's authority and one
  scope; one silent attempt, then a redirect.
- `router`: the URL codec and the page-change contract: scroll reset and h1 focus on a
  forward navigation, scroll restored on back only after render, one announcement.
- `state`: `PanelFrame`, `usePanel` and the state model; numbers only in `ready`.
- `ui`: DataTable, Pagination, a native-dialog Drawer and the announcer.
- `charts`: SVG bar and line charts with a text summary, direct labels and a data table.
- `theme`: token validation, a WCAG contrast guard and `setProperty` application.
- `testkit`: a fake gatekeeper with scenarios, `scanDist` and `strictCspProblems`.
