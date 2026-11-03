# Changelog

All notable changes to `@stromy/portal-kit`. Each release is a tag cut by `release.yml`
from the `version` in `package.json`.

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
