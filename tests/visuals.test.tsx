import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import {
  Hemicycle,
  hemicycleSeats,
  overlaps,
  placeLabels,
  Quadrant,
  StageLadder,
  stageStatus,
  StanceMatrix,
  stanceOf,
  Swimlanes,
  wrapLabel,
} from "../src/index.ts";

describe("layout", () => {
  it("wraps on spaces, cuts long words and caps the lines", () => {
    expect(wrapLabel("Council of State advice", 12)).toEqual(["Council of", "State advice"]);
    expect(wrapLabel("Supercalifragilisticexpialidocious", 10)[0]!.length).toBeLessThanOrEqual(10);
    const capped = wrapLabel("a bb ccc dddd eeeee ffffff ggggggg", 6, 2);
    expect(capped).toHaveLength(2);
    expect(capped[1]!.endsWith("…")).toBe(true);
  });

  it("never overlaps two labels or a label and a mark, even when marks crowd together", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `p${i}`,
      x: 120 + (i % 6) * 38,
      y: 80 + Math.floor(i / 6) * 30,
      r: 8,
      text: `Actor number ${i}`,
      priority: i,
    }));
    const placed = placeLabels(items, { w: 500, h: 300 });
    const shown = placed.filter((p) => p.shown);
    expect(shown.length).toBeGreaterThan(0);
    for (let a = 0; a < shown.length; a++) {
      for (let b = a + 1; b < shown.length; b++) expect(overlaps(shown[a]!.box, shown[b]!.box)).toBe(false);
      for (const m of items) {
        expect(overlaps(shown[a]!.box, { x: m.x - m.r, y: m.y - m.r, w: m.r * 2, h: m.r * 2 }, 0)).toBe(false);
      }
    }
  });

  it("places exactly the requested number of hemicycle seats, in two or more rows for a big house", () => {
    for (const n of [1, 5, 24, 150, 151]) expect(hemicycleSeats(n)).toHaveLength(n);
    expect(new Set(hemicycleSeats(150).map(([x, y]) => Math.hypot(x, y).toFixed(2))).size).toBeGreaterThan(2);
    expect(hemicycleSeats(0)).toEqual([]);
  });
});

describe("stance and stage logic", () => {
  it("reads the stance of a cell, treating close calls as mixed", () => {
    expect(stanceOf({ supportive: 3, opposed: 0 })).toBe("supportive");
    expect(stanceOf({ opposed: 2 })).toBe("opposed");
    expect(stanceOf({ supportive: 1, opposed: 1 })).toBe("mixed");
    expect(stanceOf({ mixed: 2 })).toBe("mixed");
    expect(stanceOf({})).toBe("mixed");
  });

  it("labels the ladder", () => {
    expect([0, 1, 2, 3].map((i) => stageStatus(i, 2))).toEqual(["done", "current", "next", "later"]);
  });
});

const matrix = {
  caption: "Stance by issue",
  rows: [
    { id: "a", label: "Northwind Grid", group: "Operators" },
    { id: "b", label: "Party A", group: "Parties" },
  ],
  cols: [
    { id: "i1", label: "Network tariffs" },
    { id: "i2", label: "Connection queue" },
  ],
  cells: [
    { row: "a", col: "i1", n: 4, opposed: 4 },
    { row: "b", col: "i1", n: 1, supportive: 1 },
    { row: "a", col: "i2", n: 2, mixed: 1, supportive: 1 },
  ],
};

describe("components", () => {
  it("every visual ships its table and never writes a style attribute", () => {
    const { container } = render(
      <>
        <StanceMatrix {...matrix} />
        <Quadrant caption="Voice" points={[{ id: "a", label: "Northwind", alignment: -0.5, voice: 0.4, n: 3 }, { id: "b", label: "Other", alignment: null, voice: 0.2 }]} />
        <StageLadder caption="Bill" steps={["Consultation", "Committee", "Vote"]} current={2} />
        <Hemicycle caption="Vote" factions={[{ label: "A", seats: 10, vote: "for" }, { label: "B", seats: 8, vote: "against" }]} outcome="Adopted" />
        <Swimlanes caption="Stories" lanes={[{ id: "s", label: "Tariff decision", events: [{ id: "e", at: "2026-10-14", size: 2 }, { id: "f", at: "2026-10-16", kind: "event" }] }]} />
      </>,
    );
    expect(container.querySelectorAll("figure")).toHaveLength(5);
    expect(container.querySelectorAll("details table")).toHaveLength(5);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    // Every figure states what it shows.
    for (const svg of container.querySelectorAll("svg[role=img]")) expect(svg.getAttribute("aria-label")!.length).toBeGreaterThan(20);
    // The unplaced quadrant entry is in the table, not on the plot.
    expect(container.textContent).toContain("no stance");
  });

  it("the matrix pairs colour with a glyph and is not interactive without handlers", () => {
    const { container } = render(<StanceMatrix {...matrix} />);
    expect(container.querySelector("svg")!.getAttribute("role")).toBe("img");
    expect(container.querySelectorAll("[role=button]")).toHaveLength(0);
    const glyphs = [...container.querySelectorAll("svg text.pk-glyph")].map((t) => t.textContent);
    expect(glyphs).toEqual(expect.arrayContaining(["+", "−", "±"]));
  });

  it("marks become keyboard buttons only when handlers are given, and report what was picked", () => {
    const onRow = vi.fn();
    const onCol = vi.fn();
    const onCell = vi.fn();
    const { container, getByRole } = render(<StanceMatrix {...matrix} onRow={onRow} onCol={onCol} onCell={onCell} selectedRow="a" />);
    expect(container.querySelector("svg")!.getAttribute("role")).toBe("group");
    // SVG attributes are case-sensitive: `tabIndex` would not make a mark focusable.
    for (const b of container.querySelectorAll("[role=button]")) expect(b.getAttribute("tabindex")).toBe("0");
    fireEvent.click(getByRole("button", { name: "Actor Party A: open details" }));
    expect(onRow).toHaveBeenCalledWith("b");
    fireEvent.keyDown(getByRole("button", { name: "Issue Connection queue: open details" }), { key: "Enter" });
    expect(onCol).toHaveBeenCalledWith("i2");
    fireEvent.click(getByRole("button", { name: "Northwind Grid on Network tariffs: against, 4 statements" }));
    expect(onCell).toHaveBeenCalledWith("a", "i1");
    expect(getByRole("button", { name: "Actor Northwind Grid: open details" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("draws zero lines on the quadrant and names them", () => {
    const { container } = render(<Quadrant caption="Voice" points={[{ id: "a", label: "A", alignment: 0.5, voice: 0.3 }]} />);
    expect(container.querySelectorAll("line.pk-zero").length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("Neutral");
  });

  it("the hemicycle draws one mark per seat, with a shape per vote", () => {
    const { container } = render(<Hemicycle caption="Vote" factions={[{ label: "A", seats: 10, vote: "for" }, { label: "B", seats: 6, vote: "against" }, { label: "C", seats: 4, vote: "abstain" }]} />);
    expect(container.querySelectorAll("svg[role=img] > circle, svg[role=img] > rect, svg[role=img] > polygon")).toHaveLength(20);
    expect(container.querySelectorAll("svg[role=img] > rect")).toHaveLength(6);
    expect(container.querySelectorAll("svg[role=img] > polygon")).toHaveLength(4);
  });
});
