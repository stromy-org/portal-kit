# Changelog

All notable changes to `@stromy/portal-kit`. Each release is a tag cut by `release.yml`
from the `version` in `package.json`.

## v0.5.1 — 2026-11-17

- Fix: pressing on a `NetworkGraph` node that is a link (`href`) started a pan and captured
  the pointer, so the node's click never landed. A pan now starts only off a node.

## v0.5.0 — 2026-11-17

Chart marks can be links (ORG-PLAN-605 ENTITY):

- `StanceMatrix` (`rowHref`, `colHref`), `Quadrant` (`href`), `Swimlanes` (`laneHref`) and
  `NetworkGraph` (`href`) take an optional page address per mark. With one, the mark is an
  SVG `<a href>` labelled "open its page" (`aria-current` when selected), so an entity page
  reloads, opens in a new tab and is shared. A plain left click still calls the chart's
  handler and stays in the app; a modified or middle click is left to the browser.
  Without an address a mark is the button it was.
- `followsInApp(event)` is exported for links the satellite draws itself.

## v0.4.0 — 2026-11-17

The interaction layer (ORG-PLAN-605 KIT), one shared module (`interact.tsx`) every chart uses:

- **Mark cards** on `BarChart`, `LineChart`, `Sparkline`, `StanceMatrix`, `Quadrant` and
  `Swimlanes`: value, count, unit and denominator, each given or explicitly "not
  applicable", plus a caveat. They open on hover, a touch tap and keyboard focus (the plot
  is a tab stop; arrows, Home and End step, Escape closes) and are a polite live region. The
  card is placed inside the figure (below the mark near the top, anchored inward at an
  edge) through custom properties set with `style.setProperty`. A `suppressed` figure
  (`BarDatum.suppressed`, `SeriesPoint.suppressed`) appears nowhere: not on the bar, in the
  summary, the card or the table. The native SVG `<title>` tooltips on non-interactive
  marks are replaced by the card.
- **Legend toggles** (`SeriesLegend`, `useToggles`): pressed buttons; `LineChart` shows them
  for two or more series, `BarChart` when `seriesNames` is given. A hidden series stays in
  the table, and the summary says how many are hidden.
- **Zoom and brush** with d3-zoom and d3-brush (new dependencies `d3-zoom`, `d3-brush`,
  `d3-selection`): `LineChart zoomable brushable onRange` and `Swimlanes zoomable`. Zoom is a
  local view (buttons, + / − / 0, shift-arrows, ctrl- or cmd-wheel, pinch); a plain wheel
  scrolls the page. The brush snaps to the chart's dates (`snapRange`) and is reported
  through `onRange`, never applied; native range inputs select the same range from the
  keyboard; "Zoom to range" fits it. Every d3 listener is removed on rerender and unmount.
- **`Sparkline`** for tiles: a labelled image (`sparkSummary`) with a card per period.
- `BarChart` table: the label column has a heading (`labelHeading`, default "Item") and a
  "Count" column when any datum has `n`.
- Browser tests (`e2e/interaction.spec.ts`) under the strict CSP: cards (hover, keyboard,
  touch), toggles, pointer and keyboard brushing, zoom, plain-wheel scroll, axe with every
  rule; negative controls: an inline style and a string-compiled timer are reported, and a
  brush that cannot take the pointer fails the brush assertion.

## v0.3.2 — 2026-11-10

- `NetworkGraph` fits the settled layout to its frame (a small graph no longer sits in a
  corner) and draws node labels with a surface-coloured halo, so an edge passing behind a
  label never strikes it through.

## v0.3.1 — 2026-11-10

- Wrapped labels in the stance matrix headers and swimlane names join their lines with a
  space, so a mark's accessible name contains its visible text (axe
  `label-content-name-mismatch`, found in the portal's full-rule axe run). The visuals
  browser test now runs every axe rule, not only the WCAG tags.

## v0.3.0 — 2026-11-10

- `NetworkGraph`: a navigable actor-issue network / camps graph. CSP spike result: d3-force
  is arithmetic only, run to rest with a fixed random source (deterministic), rendered as
  plain SVG; pan and zoom write the `transform` attribute, never `style`. Zoom (wheel,
  buttons, keys), pan (drag, arrows), labels re-placed per zoom without overlap, neighbourhood
  highlight, solid-blue / dashed-orange / dotted-grey links, table fallback. Browser test
  under the strict CSP in Chromium and WebKit, with a negative control.

## v0.2.0 — 2026-11-10

- New SVG visuals for the V2 design: `StanceMatrix`, `Quadrant` (voice by alignment),
  `StageLadder`, `Hemicycle` and `Swimlanes`. Each is a figure with a summary and a data
  table; stance is blue (for) against orange (against) with a polarity glyph or a shape;
  two-axis charts draw named zero lines; marks are keyboard buttons only when a handler is
  given. New stance tokens `--pk-sup/-opp/-mix` (and tints).
- Layout helpers `wrapLabel`, `placeLabels` (no two labels, or a label and a mark, overlap;
  a label that fits nowhere is left to the table) and `hemicycleSeats`, unit-tested.
- Demo "Visuals" view; browser test: axe (open and closed tables), zero CSP violations,
  keyboard activation.

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
