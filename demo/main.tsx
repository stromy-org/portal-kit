/**
 * A minimal shell on the kit, for the kit's own browser tests. It signs in with a
 * fixed test token (the auth glue has its own unit tests) and talks to the fake
 * gatekeeper the e2e server starts. It exercises: nav, runtime theme, a chart panel,
 * a paginated record table, view changes (the scroll contract) and every state.
 */

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import "../src/styles/kit.css";
import "./demo.css";
import {
  applyTheme,
  BarChart,
  byRows,
  createAnnouncer,
  DataTable,
  GatekeeperClient,
  type Nav,
  Pagination,
  PanelFrame,
  type Route,
  Router,
  safeTheme,
  type Theme,
  usePanel,
} from "../src/index.ts";

const NEUTRAL: Theme = {
  colors: { primary: "#1f3a5f", accent: "#2f7d6d", ink: "#1b1f24", surface: "#ffffff", muted: "#5c6670" },
  fonts: { font_heading: "system-ui", font_body: "system-ui" },
};

const gate = document.querySelector<HTMLMetaElement>('meta[name="pk-gate"]')?.content ?? "http://127.0.0.1:4401";
const client = new GatekeeperClient({ baseUrl: gate, getToken: async () => "test-token", retries: 3 });
const announce = createAnnouncer();

function Overview({ route, onSettled }: { route: Required<Pick<Route, "engagement" | "period">>; onSettled: () => void }) {
  const [state, retry] = usePanel(
    (signal) => client.recipe(route.engagement, route.period, "sov_by_theme", { brief_id: "brf_sov" }, signal),
    byRows,
    [route.engagement, route.period],
  );
  useEffect(() => {
    if (state.k !== "loading" && state.k !== "slow") onSettled();
  }, [state.k]);
  return (
    <>
      <h1>Overview</h1>
      <PanelFrame title="Share of voice by theme" state={state} retry={retry}>
        {(data) => (
          <BarChart
            caption="Share of voice by theme"
            data={data.rows.map((r, i) => ({ label: String(r.theme), value: Number(r.share), series: i }))}
            format={(v) => `${v}%`}
          />
        )}
      </PanelFrame>
      <div class="demo-spacer" aria-hidden="true" />
    </>
  );
}

function Evidence({ route, onSettled, go }: { route: Route & { engagement: string; period: string }; onSettled: () => void; go: (r: Route) => void }) {
  const page = Number(route.params.page ?? "1");
  const [state, retry] = usePanel(
    (signal) => client.recipe(route.engagement, route.period, "browse_records", { kind: "document", page, page_size: 5 }, signal),
    byRows,
    [route.engagement, route.period, page],
  );
  useEffect(() => {
    if (state.k !== "loading" && state.k !== "slow") onSettled();
  }, [state.k, page]);
  return (
    <>
      <h1>Evidence</h1>
      <PanelFrame title="Documents" state={state} retry={retry}>
        {(data) => (
          <>
            <DataTable caption="Documents" columns={data.columns.filter((c) => c.name !== "total")} rows={data.rows} />
            <Pagination
              page={page}
              pageSize={5}
              total={Number(data.rows[0]?.total ?? 0)}
              onPage={(p) => go({ ...route, params: { ...route.params, page: String(p) } })}
            />
          </>
        )}
      </PanelFrame>
    </>
  );
}

function App() {
  const [route, setRoute] = useState<Route>({ params: {} });
  const [nav, setNav] = useState<Nav | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [router] = useState(() => new Router({ onChange: (r) => setRoute(r), announce }));
  useEffect(() => {
    router.start();
    client.brand().then((b) => applyTheme(safeTheme(b, NEUTRAL)), () => applyTheme(NEUTRAL));
    client.nav().then(setNav, (e: Error) => setProblem(e.name === "GatekeeperError" ? (e as { kind?: string }).kind ?? "error" : "error"));
    return () => router.stop();
  }, []);
  const first = nav?.engagements.find((e) => e.period_id);
  useEffect(() => {
    if (first && !route.engagement) {
      router.navigate({ engagement: first.engagement, period: first.period_id ?? "", view: "overview", params: {} }, { replace: true });
    }
  }, [first?.engagement, route.engagement]);
  const go = (r: Route) => router.navigate(r);
  const settled = (title: string) => () => router.settled(title);
  return (
    <>
      <header>
        <nav aria-label="Views">
          {route.engagement && route.period && (
            <>
              <a href={router.href({ ...route, view: "overview", params: {} })} onClick={(e) => (e.preventDefault(), go({ ...route, view: "overview", params: {} }))}>
                Overview
              </a>{" "}
              <a href={router.href({ ...route, view: "evidence", params: {} })} onClick={(e) => (e.preventDefault(), go({ ...route, view: "evidence", params: {} }))}>
                Evidence
              </a>
            </>
          )}
        </nav>
      </header>
      <main id="main">
        {problem && <p role="status" data-problem={problem}>The portal could not load ({problem}).</p>}
        {route.engagement && route.period && route.view === "overview" && (
          <Overview route={{ engagement: route.engagement, period: route.period }} onSettled={settled("Overview")} />
        )}
        {route.engagement && route.period && route.view === "evidence" && (
          <Evidence route={{ ...route, engagement: route.engagement, period: route.period }} onSettled={settled("Evidence")} go={go} />
        )}
      </main>
    </>
  );
}

const root = document.getElementById("app");
if (root) render(<App />, root);
