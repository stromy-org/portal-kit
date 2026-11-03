import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import {
  BarChart,
  ContractError,
  DataTable,
  GatekeeperError,
  LineChart,
  Pagination,
  PanelFrame,
  type PanelState,
  pageCount,
  stateFromError,
  stateOf,
  byRows,
  type RecipeResult,
} from "../src/index.ts";

const caveat = { caveat_id: "cav_04", text: "Coverage is partial." };
const result: RecipeResult = {
  key: "k",
  release_id: "r",
  columns: [{ name: "n", type: "INTEGER" }],
  rows: [{ n: 42 }],
  caveats: [caveat],
  params: {},
};

const STATES: Array<PanelState<RecipeResult>> = [
  { k: "loading" },
  { k: "slow" },
  { k: "empty", caveats: [caveat] },
  { k: "insufficient", have: 3, need: 5, caveats: [] },
  { k: "unavailable" },
  { k: "denied" },
  { k: "error", cls: "network" },
  { k: "error", cls: "timeout" },
  { k: "error", cls: "server" },
  { k: "error", cls: "contract" },
  { k: "error", cls: "auth" },
];

function shown(state: PanelState<RecipeResult>) {
  return render(
    <PanelFrame title="Mentions" state={state} retry={() => {}}>
      {(data) => <p class="value">{String(data.rows[0]?.n)}</p>}
    </PanelFrame>,
  );
}

describe("PanelFrame", () => {
  it("shows a number only when ready", () => {
    const ready = shown({ k: "ready", data: result, caveats: [caveat] });
    expect(ready.container.querySelector(".value")?.textContent).toBe("42");
    expect(ready.container.textContent).toContain("Coverage is partial.");
    ready.unmount();
    for (const state of STATES) {
      const view = shown(state);
      const text = view.container.textContent ?? "";
      // The title and the insufficient threshold are the only digits allowed.
      const digits = text.replace("3 found, at least 5 needed", "").match(/\d/g);
      expect(digits, state.k).toBeNull();
      expect(view.container.querySelector(".value"), state.k).toBeNull();
      expect(view.container.querySelector("[data-state]")?.getAttribute("data-state")).toBe(state.k);
      view.unmount();
    }
  });

  it("offers retry on transport failures but not on denial or expired sign-in", () => {
    for (const [state, retry] of [
      [{ k: "error", cls: "network" }, true],
      [{ k: "error", cls: "auth" }, false],
      [{ k: "denied" }, false],
    ] as const) {
      const view = shown(state);
      expect(Boolean(view.container.querySelector("button")), JSON.stringify(state)).toBe(retry);
      view.unmount();
    }
  });

  it("derives states from data and errors", () => {
    expect(stateOf({ ...result, rows: [] }, byRows).k).toBe("empty");
    expect(stateOf(result, () => ({ have: 2, need: 5 }))).toMatchObject({ k: "insufficient", have: 2, need: 5 });
    expect(stateFromError(new GatekeeperError("denied", 403))).toEqual({ k: "denied" });
    expect(stateFromError(new GatekeeperError("unavailable", 503))).toEqual({ k: "unavailable" });
    expect(stateFromError(new ContractError("x"))).toEqual({ k: "error", cls: "contract" });
    expect(stateFromError(new Error("boom"))).toEqual({ k: "error", cls: "server" });
  });
});

describe("primitives", () => {
  it("renders a real table with a caption and column headers", () => {
    const view = render(<DataTable caption="Sources" columns={result.columns} rows={[{ n: null }, { n: { a: 1 } }]} labels={{ n: "Count" }} />);
    expect(view.container.querySelector("caption")?.textContent).toBe("Sources");
    expect(view.container.querySelector("th[scope=col]")?.textContent).toBe("Count");
    expect([...view.container.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["—", '{"a":1}']);
  });

  it("labels pagination and clamps pages", () => {
    const pages: number[] = [];
    const view = render(<Pagination page={1} pageSize={25} total={60} onPage={(p) => pages.push(p)} />);
    expect(view.container.textContent).toContain("Page 1 of 3");
    expect(view.container.querySelector("nav")?.getAttribute("aria-label")).toBe("Pagination");
    const [prev, next] = [...view.container.querySelectorAll("button")];
    expect(prev?.hasAttribute("disabled")).toBe(true);
    next?.click();
    expect(pages).toEqual([2]);
    expect(pageCount(0, 25)).toBe(1);
  });

  it("charts carry a text summary, direct labels and a data table, with no style attribute", () => {
    const bars = render(
      <BarChart caption="Share of voice" data={[{ label: "A", value: 40 }, { label: "B", value: 60, series: 1 }]} format={(v) => `${v}%`} />,
    );
    const svg = bars.container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toContain("highest is B at 60%");
    expect(bars.container.querySelectorAll("rect")).toHaveLength(2);
    expect(bars.container.querySelector("details table")).not.toBeNull();
    const line = render(
      <LineChart
        caption="Mentions per week"
        series={[{ name: "Grid", points: [{ at: "2026-09-07", value: 3 }, { at: "2026-09-14", value: 5 }] }]}
      />,
    );
    expect(line.container.querySelector("path.pk-line")?.getAttribute("d")).toMatch(/^M/);
    for (const el of [...bars.container.querySelectorAll("*"), ...line.container.querySelectorAll("*")]) {
      expect(el.hasAttribute("style"), el.tagName).toBe(false);
    }
  });
});
