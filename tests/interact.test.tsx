import { cleanup, fireEvent, render } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BarChart, detailLines, LineChart, snapRange, Sparkline, sparkSummary, StanceMatrix, Swimlanes } from "../src/index.ts";

afterEach(cleanup);

const tip = (root: Element) => root.querySelector(".pk-tip")!;
const plot = (root: Element) => root.querySelector<HTMLElement>(".pk-plot")!;
const key = (el: Element, k: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(el, { key: k, ...extra });

/** d3-selection keeps a node's listeners in `__on`; the names tell whose they are. */
const listeners = (node: Element | null) => ((node as unknown as { __on?: Array<{ type: string; name: string }> })?.__on ?? []).map((l) => `${l.type}.${l.name}`);

describe("mark cards", () => {
  it("say the value, count, unit and denominator, or that one does not apply", () => {
    expect(detailLines({ label: "Prices", value: "31%", n: 12, unit: "share of statements", denominator: "all statements in the period", caveat: "Partial coverage." })).toEqual([
      "Prices",
      "Value: 31%",
      "Count: 12",
      "Unit: share of statements",
      "Out of: all statements in the period",
      "Partial coverage.",
    ]);
    expect(detailLines({ label: "Votes", value: "3" })).toEqual(["Votes", "Value: 3", "Count: not applicable", "Unit: not applicable", "Out of: not applicable"]);
  });

  it("never show a suppressed figure", () => {
    const lines = detailLines({ label: "Small group", value: "77%", n: 4, suppressed: "fewer than 10 statements" });
    expect(lines).toEqual(["Small group", "Not shown: fewer than 10 statements"]);
    expect(lines.join(" ")).not.toMatch(/77|\b4\b/);
  });

  it("open on hover, step with the arrow keys, and close on Escape and on leaving", () => {
    const view = render(
      <BarChart
        caption="Share of voice"
        unit="share of statements"
        denominator="all statements on the brief"
        format={(v) => `${v}%`}
        data={[
          { label: "Grid", value: 42, n: 21 },
          { label: "Prices", value: 31, n: 15, caveat: "One outlet only." },
        ]}
      />,
    );
    expect(tip(view.container).classList.contains("pk-tip--off")).toBe(true);
    fireEvent.pointerEnter(view.container.querySelectorAll(".pk-mark")[1]!);
    expect(tip(view.container).textContent).toBe("PricesValue: 31%Count: 15Unit: share of statementsOut of: all statements on the briefOne outlet only.");
    expect(tip(view.container).getAttribute("role")).toBe("status");
    fireEvent.pointerLeave(plot(view.container), { pointerType: "mouse" });
    expect(tip(view.container).textContent).toBe("");
    const p = plot(view.container);
    expect(p.getAttribute("tabindex")).toBe("0");
    key(p, "ArrowRight");
    expect(tip(view.container).textContent).toContain("Grid");
    key(p, "ArrowRight");
    expect(tip(view.container).textContent).toContain("Prices");
    key(p, "Home");
    expect(tip(view.container).textContent).toContain("Grid");
    key(p, "Escape");
    expect(tip(view.container).textContent).toBe("");
  });

  it("open on a touch tap", () => {
    const view = render(<BarChart caption="Tap" data={[{ label: "Grid", value: 4 }]} />);
    fireEvent.pointerDown(view.container.querySelector(".pk-mark")!, { pointerType: "touch" });
    expect(tip(view.container).textContent).toContain("Value: 4");
  });

  it("a suppressed bar shows its figure nowhere: bar, label, summary, card or table", () => {
    const view = render(
      <BarChart
        caption="Shares"
        format={(v) => `${v}%`}
        data={[
          { label: "Large", value: 60, n: 30 },
          { label: "Small", value: 77, n: 4, suppressed: "fewer than 10 statements" },
        ]}
      />,
    );
    fireEvent.pointerEnter(view.container.querySelectorAll(".pk-mark")[1]!);
    (view.container.querySelector("details") as HTMLDetailsElement).open = true;
    const text = view.container.textContent ?? "";
    expect(text).toContain("Not shown: fewer than 10 statements");
    expect(text).toContain("withheld");
    expect(text).not.toMatch(/77/);
    expect(view.container.querySelector("svg")?.getAttribute("aria-label")).not.toMatch(/77/);
    expect(view.container.querySelectorAll("rect[class*=pk-series-]")).toHaveLength(1);
  });

  it("render no style attribute before interaction", () => {
    const view = render(<BarChart caption="S" data={[{ label: "A", value: 1 }]} />);
    for (const el of view.container.querySelectorAll("*")) expect(el.hasAttribute("style"), el.tagName).toBe(false);
  });

  it("work on the rich visuals, with an explicit denominator", () => {
    const view = render(
      <StanceMatrix
        caption="Stance"
        rows={[{ id: "a", label: "Alpha" }]}
        cols={[{ id: "i", label: "Tariffs" }]}
        cells={[{ row: "a", col: "i", n: 5, opposed: 4, mixed: 1 }]}
        denominator="Alpha's statements on the issue"
      />,
    );
    key(plot(view.container), "ArrowRight");
    expect(tip(view.container).textContent).toBe("Alpha on TariffsValue: against: 0 for, 4 against, 1 mixedCount: 5Unit: statementsOut of: Alpha's statements on the issue");
  });
});

describe("legend toggles", () => {
  it("hide and show a bar series; the table keeps every row", () => {
    const view = render(
      <BarChart
        caption="By side"
        seriesNames={["Supporters", "Opponents"]}
        data={[
          { label: "A", value: 3, series: 0 },
          { label: "B", value: 5, series: 1 },
        ]}
      />,
    );
    const opp = view.getByRole("button", { name: /Opponents/ });
    expect(opp.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(opp);
    expect(opp.getAttribute("aria-pressed")).toBe("false");
    expect(view.container.querySelectorAll("svg[role=img] rect[class*=pk-series-]")).toHaveLength(1);
    expect(view.container.querySelectorAll("details tbody tr")).toHaveLength(2);
    fireEvent.click(opp);
    expect(view.container.querySelectorAll("svg[role=img] rect[class*=pk-series-]")).toHaveLength(2);
  });

  it("hide a line series and say so in the summary", () => {
    const view = render(
      <LineChart
        caption="Trends"
        series={[
          { name: "Grid", points: [{ at: "2026-10-01", value: 2 }, { at: "2026-10-08", value: 4 }] },
          { name: "Prices", points: [{ at: "2026-10-01", value: 1 }, { at: "2026-10-08", value: 3 }] },
        ]}
      />,
    );
    expect(view.container.querySelectorAll("path.pk-line")).toHaveLength(2);
    fireEvent.click(view.getByRole("button", { name: /Prices/ }));
    expect(view.container.querySelectorAll("path.pk-line")).toHaveLength(1);
    expect(view.container.querySelector("svg[role=img]")?.getAttribute("aria-label")).toContain("1 hidden by the legend");
  });
});

describe("brush and zoom", () => {
  const series = [{ name: "Docs", points: ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"].map((at, i) => ({ at, value: i + 1, n: i + 1 })) }];

  it("snap a brushed span to the dates the chart has", () => {
    const dates = ["2026-10-01", "2026-10-08", "2026-10-15"];
    expect(snapRange(dates, Date.parse("2026-10-03"), Date.parse("2026-10-16"))).toEqual({ from: "2026-10-08", to: "2026-10-15" });
    expect(snapRange(dates, Date.parse("2026-10-16"), Date.parse("2026-10-03"))).toEqual({ from: "2026-10-08", to: "2026-10-15" });
    expect(snapRange(dates, Date.parse("2026-10-02"), Date.parse("2026-10-03"))).toBeNull();
  });

  it("select a range from the keyboard, report it, and clear it", () => {
    const onRange = vi.fn();
    const view = render(<LineChart caption="Docs per week" series={series} brushable zoomable onRange={onRange} />);
    const [from, to] = view.getAllByRole("slider");
    fireEvent.input(from!, { target: { value: "1" } });
    expect(onRange).toHaveBeenLastCalledWith({ from: "2026-10-08", to: "2026-10-22" });
    fireEvent.input(to!, { target: { value: "2" } });
    expect(onRange).toHaveBeenLastCalledWith({ from: "2026-10-08", to: "2026-10-15" });
    expect(view.container.querySelector("[data-range-out]")?.textContent).toBe("2026-10-08 to 2026-10-15 (2 dates)");
    expect(view.container.querySelector("rect.pk-range")?.getAttribute("data-range")).toBe("2026-10-08/2026-10-15");
    expect(view.getByRole("button", { name: "Zoom to range" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Clear range" }));
    expect(onRange).toHaveBeenLastCalledWith(null);
    expect(view.container.querySelector("rect.pk-range")).toBeNull();
  });

  it("bind d3 listeners only when asked, and unbind them on rerender and unmount", async () => {
    const view = render(<LineChart caption="Docs" series={series} zoomable brushable />);
    const svg = view.container.querySelector("svg[role=img]");
    const brush = view.container.querySelector("g.pk-brush");
    expect(listeners(svg)).toContain("wheel.zoom");
    expect(listeners(brush).some((l) => l.endsWith(".brush"))).toBe(true);
    expect(brush?.querySelector("rect.overlay")).not.toBeNull();
    view.rerender(<LineChart caption="Docs" series={series} />);
    expect(listeners(svg).filter((l) => l.endsWith(".zoom"))).toEqual([]);
    expect(listeners(brush).filter((l) => l.endsWith(".brush"))).toEqual([]);
    expect(brush?.childElementCount).toBe(0);
    view.rerender(<LineChart caption="Docs" series={series} zoomable />);
    expect(listeners(svg)).toContain("wheel.zoom");
    view.unmount();
    // Preact runs an unmounted component's effect cleanups after the current task.
    await vi.waitFor(() => expect(listeners(svg).filter((l) => l.endsWith(".zoom"))).toEqual([]));
  });

  it("a chart that does not zoom binds nothing and shows no zoom controls", () => {
    const view = render(<LineChart caption="Docs" series={series} />);
    expect(listeners(view.container.querySelector("svg[role=img]"))).toEqual([]);
    expect(view.queryByRole("button", { name: "Zoom in" })).toBeNull();
    expect(view.queryAllByRole("slider")).toHaveLength(0);
  });

  it("the story timeline zooms with its own controls", () => {
    const view = render(<Swimlanes caption="Stories" zoomable lanes={[{ id: "s", label: "Story", events: [{ id: "e", at: "2026-10-02", size: 2 }] }]} />);
    expect(view.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(view.container.querySelector("svg")?.getAttribute("data-zoom")).toBe("1.00");
    key(plot(view.container), "ArrowRight");
    expect(tip(view.container).textContent).toContain("Count: 2");
  });
});

describe("sparkline", () => {
  const points = [
    { at: "2026-10-01", value: 3 },
    { at: "2026-10-08", value: 9 },
    { at: "2026-10-15", value: 5 },
  ];

  it("names its trend in words", () => {
    expect(sparkSummary("Documents per week", points)).toBe("Documents per week: 3 values from 2026-10-01 to 2026-10-15; latest 5, highest 9 on 2026-10-08.");
    expect(sparkSummary("Empty", [])).toBe("Empty: no values.");
  });

  it("opens a card per period", () => {
    const view = render(<Sparkline label="Documents per week" points={points} unit="documents" />);
    expect(view.container.querySelector("svg")?.getAttribute("aria-label")).toContain("latest 5");
    fireEvent.pointerEnter(view.container.querySelectorAll("rect.pk-hit__area")[1]!);
    expect(tip(view.container).textContent).toBe("Documents per week, 2026-10-08Value: 9Count: not applicableUnit: documentsOut of: not applicable");
  });
});
