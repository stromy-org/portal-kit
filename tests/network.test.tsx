import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { layoutGraph, NetworkGraph, overlaps } from "../src/index.ts";

const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, kind: i % 4 === 0 ? ("issue" as const) : ("actor" as const), weight: i + 1 }));
const edges = nodes.slice(1).map((n, i) => ({ source: n.id, target: `n${i % 3 === 0 ? 0 : i}`, polarity: (["supportive", "opposed", "mixed"] as const)[i % 3]!, weight: 1 + (i % 3) }));

describe("NetworkGraph", () => {
  it("lays out the same input to the same positions, inside the frame, without coinciding nodes", () => {
    const a = layoutGraph(nodes, edges);
    expect(layoutGraph(nodes, edges)).toEqual(a);
    for (const p of a) expect(p.x).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < a.length; i++)
      for (let j = i + 1; j < a.length; j++) expect(Math.hypot(a[i]!.x - a[j]!.x, a[i]!.y - a[j]!.y)).toBeGreaterThan(8);
  });

  it("draws no style attribute and ships its table", () => {
    const { container } = render(<NetworkGraph caption="Network" nodes={nodes} edges={edges} />);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(container.querySelectorAll("details tbody tr")).toHaveLength(edges.length);
  });

  it("shown labels never overlap each other", () => {
    const { container } = render(<NetworkGraph caption="Network" nodes={nodes} edges={edges} />);
    const texts = [...container.querySelectorAll("text.pk-chart__label")].map((t) => ({
      x: Number(t.getAttribute("x")),
      y: Number(t.getAttribute("y")),
      w: (t.textContent ?? "").length * 6.7,
      anchor: t.getAttribute("text-anchor"),
    }));
    const boxes = texts.map((t) => ({ x: t.anchor === "end" ? t.x - t.w : t.anchor === "middle" ? t.x - t.w / 2 : t.x, y: t.y - 7, w: t.w, h: 14 }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!, 0)).toBe(false);
  });

  it("selects by click and by keyboard", () => {
    const onSelect = vi.fn();
    const { getByRole } = render(<NetworkGraph caption="Network" nodes={nodes} edges={edges} onSelect={onSelect} />);
    fireEvent.click(getByRole("button", { name: /^Actor Node 1,/ }));
    fireEvent.keyDown(getByRole("button", { name: /^Issue Node 4,/ }), { key: "Enter" });
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual(["n1", "n4"]);
  });
});
