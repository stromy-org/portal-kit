/**
 * ORG-PLAN-605 VIS: a BarChart diverges from a drawn zero line when a value is below zero,
 * and a Quadrant reads any two measures (attention against tone) with its own words, while
 * its defaults still read voice against alignment.
 */
import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { BarChart, Quadrant, summarise } from "../src/index.ts";

const tone = [
  { label: "Daily Grid · Northwind", value: 0.8, n: 12 },
  { label: "Daily Grid · Eastline", value: -1.2, n: 11 },
  { label: "Energy Post · Northwind", value: 0, n: 10 },
];

describe("BarChart below zero", () => {
  it("draws a zero line and bars on both sides of it, with signed labels", () => {
    const { container } = render(<BarChart caption="Tone" data={tone} format={(v) => v.toFixed(1)} />);
    const zero = container.querySelector("line.pk-zero")!;
    expect(zero).not.toBeNull();
    const zx = Number(zero.getAttribute("x1"));
    const [pos, neg] = [...container.querySelectorAll("rect.pk-series-0, rect.pk-bar--neg")].map((r) => ({
      x: Number(r.getAttribute("x")),
      w: Number(r.getAttribute("width")),
      neg: r.classList.contains("pk-bar--neg"),
    }));
    expect(pos!.neg).toBe(false);
    expect(pos!.x).toBeCloseTo(zx); // starts at zero, grows right
    expect(neg!.neg).toBe(true);
    expect(neg!.x + neg!.w).toBeCloseTo(zx); // ends at zero, grows left
    expect([...container.querySelectorAll("text.pk-chart__value")].map((t) => t.textContent)).toEqual(["0.8", "-1.2", "0.0"]);
  });

  it("names both ends in the summary, and only diverges when a value is below zero", () => {
    expect(summarise(tone, (v) => v.toFixed(1))).toBe("3 values; highest is Daily Grid · Northwind at 0.8, lowest is Daily Grid · Eastline at -1.2.");
    const { container } = render(<BarChart caption="Share" data={[{ label: "A", value: 3 }, { label: "B", value: 1 }]} />);
    expect(container.querySelector("line.pk-zero")).toBeNull();
    expect(container.querySelector("rect.pk-bar--neg")).toBeNull();
  });

  it("a withheld value stays out of the scale, the bar, the card and the table", () => {
    const { container } = render(<BarChart caption="Tone" data={[...tone, { label: "Thin", value: -9, suppressed: true }]} />);
    expect(container.textContent).not.toContain("-9");
    expect(container.querySelectorAll("rect.pk-bar--neg")).toHaveLength(1);
  });
});

describe("Quadrant with its own measures", () => {
  const points = [
    { id: "a", label: "Northwind", alignment: 1.5, voice: 0.6, n: 20 },
    { id: "b", label: "Eastline", alignment: -1.0, voice: 0.3, n: 9 },
    { id: "c", label: "Quiet one", alignment: null, voice: 0.1 },
  ];
  it("places points on the given scale and says what it measures", () => {
    const { container, getByRole } = render(
      <Quadrant
        caption="Attention against tone"
        points={points}
        xDomain={[-2, 2]}
        words={{
          axis: "Mean tone, from −2 (negative) to +2 (positive)",
          low: "−2 negative",
          high: "+2 positive",
          corners: ["Much attention, negative", "Much attention, positive", "Little attention, negative", "Little attention, positive"],
          sides: ["negative", "neutral", "positive"],
          xName: "tone",
          xHeading: "Mean tone (-2 to +2)",
          yOf: "of the documents",
          yHeading: "Attention",
          placedBy: "how much attention they get and its tone",
          footnote: "Tone is read from the text around each mention.",
          missing: "too few mentions",
        }}
      />,
    );
    const text = container.textContent!;
    for (const w of ["Mean tone, from −2 (negative) to +2 (positive)", "Much attention, positive", "Little attention, negative", "Mean tone (-2 to +2)", "too few mentions"])
      expect(text).toContain(w);
    expect(text).not.toContain("Loud allies");
    expect(container.querySelector("figure")!.textContent).toContain("2 actors placed by how much attention they get and its tone; 1 entry with too few mentions is listed in the table only. Tone is read from the text around each mention.");
    // +1.5 on a -2..+2 scale sits right of zero and left of the edge, not clamped to it.
    const zero = Number(container.querySelector("line.pk-zero")!.getAttribute("x1"));
    const cx = Number(container.querySelector("circle.pk-bubble")!.getAttribute("cx"));
    expect(cx).toBeGreaterThan(zero);
    expect(cx).toBeLessThan(640 - 24);
  });

  it("keeps reading voice against alignment by default", () => {
    const { container } = render(<Quadrant caption="Voice" points={[{ id: "a", label: "A", alignment: 0.5, voice: 0.3 }]} />);
    expect(container.textContent).toContain("Loud allies");
    expect(container.textContent).toContain("Alignment with the engagement's position");
  });
});

describe("BarChart row names", () => {
  // Fleet Intel T74 (2026-11-28): a 35-character issue name on the hosted overview ran past the
  // SVG's left edge and lost its first letters. Every line of a row name now fits its column.
  const long = "SPRINT under the European Chips Act";

  it("wraps a name wider than its column, and every line fits left of the bars", async () => {
    const { textWidth } = await import("../src/index.ts");
    const { container } = render(<BarChart caption="Top issues" data={[{ label: long, value: 7 }, { label: "Export controls", value: 3 }]} />);
    const [first, second] = [...container.querySelectorAll("text.pk-chart__label")];
    const lines = [...first!.querySelectorAll("tspan")].map((t) => t.textContent ?? "");
    expect(lines.length).toBe(2);
    expect(lines.join(" ")).toBe(long); // nothing lost, nothing cut
    const column = Number(first!.getAttribute("x")); // right-aligned at the column's edge
    for (const line of lines) expect(textWidth(line, 12)).toBeLessThanOrEqual(column);
    // A short name stays one plain line; the whole name stays in the table.
    expect(second!.querySelector("tspan")).toBeNull();
    expect(second!.textContent).toBe("Export controls");
    expect([...container.querySelectorAll("td")].map((td) => td.textContent)).toContain(long);
  });

  it("ends a name too long for two lines in an ellipsis, and keeps one-line rows at their height", async () => {
    const { textWidth } = await import("../src/index.ts");
    const huge = "Commission proposal on the governance of strategic semiconductor supply chains and their financing";
    const { container } = render(<BarChart caption="Top" data={[{ label: huge, value: 2 }]} />);
    const label = container.querySelector("text.pk-chart__label")!;
    const lines = [...label.querySelectorAll("tspan")].map((t) => t.textContent ?? "");
    expect(lines.length).toBe(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    for (const line of lines) expect(textWidth(line, 12)).toBeLessThanOrEqual(Number(label.getAttribute("x")));
    const short = render(<BarChart caption="S" data={[{ label: "A", value: 1 }]} />);
    expect(short.container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 640 28");
  });
});

describe("Quadrant labels", () => {
  it("never places a point's label over a corner word (the attention-against-tone overlap)", async () => {
    const { textWidth } = await import("../src/index.ts");
    // A point high on the right, where "Much attention, positive" / "Loud allies" is written.
    const { container } = render(<Quadrant caption="Voice" points={[{ id: "a", label: "Eastline Power", alignment: 0.6, voice: 1, n: 30 }]} />);
    const labels = [...container.querySelectorAll("text.pk-chart__label")];
    const corner = [...container.querySelectorAll("text.pk-chart__axis")].find((t) => t.textContent === "Loud allies")!;
    const cx = Number(corner.getAttribute("x"));
    const cw = textWidth("Loud allies", 12);
    const cy = Number(corner.getAttribute("y"));
    for (const l of labels) {
      const x = Number(l.getAttribute("x"));
      const y = Number(l.getAttribute("y"));
      const lw = textWidth(l.textContent ?? "", 12);
      const anchor = l.getAttribute("text-anchor") ?? "start";
      const left = anchor === "end" ? x - lw : anchor === "middle" ? x - lw / 2 : x;
      const overlapX = left < cx && left + lw > cx - cw;
      const overlapY = Math.abs(y - cy) < 14;
      expect(overlapX && overlapY, `label "${l.textContent}" over the corner word`).toBe(false);
    }
  });
});

describe("BarChart value labels", () => {
  it("keep clear of the right edge and of the row names (the movers chart)", async () => {
    const { textWidth } = await import("../src/index.ts");
    const fmtPts = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pts`;
    const data = [
      { label: "Eastline Power", value: 50 },
      { label: "Northwind Grid", value: 0 },
      { label: "Westvale Energy", value: -50 },
    ];
    const { container } = render(<BarChart caption="Change" data={data} format={fmtPts} />);
    const width = 640;
    const labelWidth = Math.min(220, Math.round(width * 0.34));
    for (const t of container.querySelectorAll("text.pk-chart__value")) {
      const x = Number(t.getAttribute("x"));
      const w = textWidth(t.textContent ?? "", 12);
      if (t.getAttribute("text-anchor") === "end") expect(x - w, t.textContent!).toBeGreaterThanOrEqual(labelWidth);
      else expect(x + w, t.textContent!).toBeLessThanOrEqual(width);
    }
  });
});
