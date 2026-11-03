<!--
  GENERATED FILE — DO NOT EDIT.
  Source of truth: AGENTS.md (cross-vendor standard).
  Override file:   .agent-overrides/copilot.md (optional, appended below)
  Regenerate with: scripts/render-agent-md.py
-->

# AGENTS.md

Self-contained instructions for agents working on `@stromy/portal-kit`.

> **AGENTS.md is the canonical instruction file** for this repo. `CLAUDE.md` and
> `.github/copilot-instructions.md` are generated from it by `scripts/render-agent-md.py`.
> **Do not hand-edit the generated files.**

<!-- org-core:start v1 GENERATED from global-skills/global-instructions/org-core.md by stromy-org scripts/render-org-core.py; edit the source, not this copy -->
## Org core — how work lands in this org

This repository belongs to the stromy-org fleet. These rules apply here whichever agent you are and wherever this clone lives. The machine rules (git safety, worktrees, commits, `.env`) come from your user-level instructions; this block does not repeat them.

- **The control plane is `stromy-org/stromy-org`.** Its `catalog.json` is the inventory of every repo. **Work that spans more than one repo starts from a stromy-org root checkout, not from here.** That includes a parent submodule pointer, a shared template or skill, and a fleet-wide check.
- **Land through a branch and a PR** (`gh pr create`, or `scripts/sync.sh land` from the stromy-org root). A pushed branch without a PR is parked, not landed. **Every PR you mention carries its full URL** (`https://github.com/<owner>/<repo>/pull/<n>`), never only `#<n>`.
- **Parent submodule pointers are bot-owned.** When this repo is a stromy-org submodule, push its branch and stop. Never hand-edit or stage the parent's gitlink.
- **Merging a `deploy_on_main` repo deploys it.** `catalog.json` marks those repos. A merge needs an explicit deploy decision: the reviewed route (`premerge_review.py`, then `merge-reviewed.sh`, both run from the stromy-org root) or an operator yes for that specific PR. It is never a wrap-up side effect. Merge over a red check only when the failure is proven to already exist on `main`.
- **Every commit goes through the `conventional-commit` skill**: Conventional Commits with gitmoji.
- **Backlog and plans:** track work with the `backlog` skill against this repo's own backlog, and plan with the `plan-*` skills. Never hand-edit a rendered `BACKLOG.md` or `DONE.md` where a renderer owns it.
- **Generated files are never hand-edited.** `CLAUDE.md` and `.github/copilot-instructions.md` are rendered from `AGENTS.md` (`scripts/render-agent-md.py`). This block is rendered from the org-core source in `global-skills`, and `scripts/check-org-core.py --check` verifies it. To change it, edit the source in `global-skills` and re-render; never edit the copy here.
- **Client confidentiality:** never name a client, its end clients, projects or people in anything another client can read.
- **Contract:** `infra-docs/ai/instruction-distribution.md` defines which instructions reach which agent, and the budgets.
<!-- org-core:end -->

## Project Overview

`@stromy/portal-kit` is the evolving half of a Stromy **portal shell**: a static, data-free
web app that signs a person in with Entra and reads everything from an authorization
gatekeeper on another origin. Shells are created from the `portal-shell-template` Copier
archetype and pin this package by tag; anything every shell needs to keep current lives
here, and the template holds only glue, seams and seeds. Design and decisions:
`plans/ORG-PLAN-369_client-intelligence-platform/portal-shell.md` in stromy-org.

## Commands

```bash
npm ci --ignore-scripts
npm run check           # tsc --noEmit + vitest (unit and component)
npm run e2e             # Playwright on the demo shell + fake gatekeeper (Chromium)
PK_BROWSERS=all npm run e2e   # Chromium, Firefox and WebKit
```

## Modules

| Path | What it owns |
|---|---|
| `src/contract` | The gatekeeper data contract and its hand-written runtime validators |
| `src/client` | `GatekeeperClient`: auth header, GET-only retries with jitter, timeouts, the failure taxonomy |
| `src/auth` | MSAL 5 glue: redirect flow, session storage, resource-tenant authority, one scope |
| `src/router` | URL codec and the page-change contract (scroll reset, focus, restore on back) |
| `src/state` | `PanelFrame`, `usePanel` and the state model: numbers only in `ready` |
| `src/ui` | DataTable, Pagination, Drawer (native dialog), the announcer |
| `src/charts` | Hand-rolled SVG bar and line charts, each with a text summary and data table |
| `src/theme` | Token validation, the contrast guard, `setProperty` application |
| `src/testkit` | Fake gatekeeper, `scanDist`, `strictCspProblems` (Node only) |
| `src/styles/kit.css` | Base tokens and component classes |

## Invariants

- **No inline styles and no eval anywhere.** Shells ship `style-src 'self'` and no
  `'unsafe-eval'`. Write CSS custom properties with `style.setProperty`, never
  `setAttribute('style')` or `cssText`. Do not add a dependency that probes `new Function`
  (zod 4 does). The e2e suite fails on any CSP violation, and its negative control proves it.
- **No number outside `ready`.** `PanelFrame`'s switch is exhaustive; a new state must be
  rendered in words.
- **The browser holds a short-lived, single-scope token for read-only data only.** Writes,
  regulated data, sessions beyond 24 hours or broader scopes require a BFF instead
  (portal-shell.md decision 4).
- **Fixtures are fictional.** Never put a client, end client, project or person in a
  fixture, test or example.
- **Releases are tags.** Bump `version` in `package.json` in a PR, then dispatch
  `release.yml`; consumers pin `github:stromy-org/portal-kit#vX.Y.Z`. Record each release in
  `CHANGELOG.md` under `## vX.Y.Z — YYYY-MM-DD`.

## Agent-md rendering

`AGENTS.md` is the only authored agent-instruction file. Regenerate the rest:

```bash
python3 scripts/render-agent-md.py
python3 scripts/render-agent-md.py --check
```
