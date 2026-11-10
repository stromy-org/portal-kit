/** @jsxImportSource preact */
/**
 * A navigable network graph (dashboard-content.md section 11: "zoom, pan, labels without
 * overlap"). It serves the actor-issue network and the camps view.
 *
 * CSP spike result (ORG-PLAN-369 C7-V2): d3-force is pure arithmetic (no eval, no
 * `Function`, no DOM) and is run to rest synchronously with a fixed random source, so the
 * layout is deterministic and the graph is plain SVG. Pan and zoom write the `transform`
 * ATTRIBUTE on one group, never a `style`, which a strict style-src leaves alone. The
 * portal-kit browser test proves it under the shell's real CSP, with a negative control.
 *
 * - zoom: wheel, the +/- buttons, or the + and - keys; pan: drag, or the arrow keys;
 * - labels are re-placed as the zoom changes (more fit when zoomed in) and never overlap;
 * - selecting a node fades everything except its neighbourhood;
 * - actors are circles, issues are squares; an edge is solid blue (for / allied), dashed
 *   orange (against / opposed) or dotted grey (mixed), so colour is never the only cue;
 * - the same rows are in a table, and every node is a keyboard button when a handler is set.
 */

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { useMemo, useRef, useState } from "preact/hooks";

import type { Column } from "../contract/index.ts";
import { DataTable } from "../ui/index.tsx";
import { type LabelItem, placeLabels } from "./layout.ts";

export interface GraphNode {
  id: string;
  label: string;
  kind: "actor" | "issue";
  group?: string;
  /** Sizes the node (statements, say). */
  weight?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  polarity: "supportive" | "opposed" | "mixed";
  /** Widens the edge (statements, or shared issues). */
  weight?: number;
}

export interface NetworkGraphProps {
  caption: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected?: string;
  onSelect?: (id: string) => void;
  /** Words for the edge kinds in the legend and table, e.g. "allied" / "opposed". */
  words?: { supportive: string; opposed: string; mixed: string };
}

const W = 720;
const H = 460;
const POLARITY_CLASS = { supportive: "pk-edge--sup", opposed: "pk-edge--opp", mixed: "pk-edge--mix" } as const;

interface Laid {
  id: string;
  x: number;
  y: number;
  r: number;
}

/** Positions every node: deterministic for the same input. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): Laid[] {
  if (!nodes.length) return [];
  let seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const maxWeight = Math.max(1, ...nodes.map((n) => n.weight ?? 1));
  const sim = nodes.map((n, i) => ({
    id: n.id,
    r: 8 + Math.sqrt((n.weight ?? 1) / maxWeight) * 9,
    // Start on a ring: deterministic and never coincident.
    x: W / 2 + Math.cos((i / nodes.length) * 2 * Math.PI) * 120,
    y: H / 2 + Math.sin((i / nodes.length) * 2 * Math.PI) * 120,
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target }));
  const simulation = forceSimulation(sim)
    .randomSource(random)
    .force("link", forceLink<(typeof sim)[number], { source: string; target: string }>(links).id((d) => d.id).distance(90).strength(0.5))
    .force("charge", forceManyBody().strength(-220))
    .force("collide", forceCollide<(typeof sim)[number]>().radius((d) => d.r + 14))
    .force("x", forceX(W / 2).strength(0.06))
    .force("y", forceY(H / 2).strength(0.06))
    .stop();
  for (let i = 0; i < 300; i++) simulation.tick();
  // Fit the settled layout to the frame, so a small graph is not left in a corner.
  const xs = sim.map((n) => n.x!);
  const ys = sim.map((n) => n.y!);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const padX = 90;
  const padY = 40;
  const k = Math.min(2.2, (W - 2 * padX) / Math.max(1, x1 - x0), (H - 2 * padY) / Math.max(1, y1 - y0));
  return sim.map((n) => ({
    id: n.id,
    r: n.r,
    x: W / 2 + (n.x! - (x0 + x1) / 2) * k,
    y: H / 2 + (n.y! - (y0 + y1) / 2) * k,
  }));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function NetworkGraph(props: NetworkGraphProps) {
  const words = props.words ?? { supportive: "for", opposed: "against", mixed: "mixed" };
  const key = JSON.stringify([props.nodes.map((n) => [n.id, n.weight]), props.edges.map((e) => [e.source, e.target])]);
  const laid = useMemo(() => layoutGraph(props.nodes, props.edges), [key]);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const groups = [...new Set(props.nodes.map((n) => n.group ?? ""))];
  const at = new Map(laid.map((l) => [l.id, l]));
  const byId = new Map(props.nodes.map((n) => [n.id, n]));
  const near = new Set<string>();
  if (props.selected) {
    near.add(props.selected);
    for (const e of props.edges) {
      if (e.source === props.selected) near.add(e.target);
      if (e.target === props.selected) near.add(e.source);
    }
  }
  const zoomTo = (k: number, cx = W / 2, cy = H / 2) =>
    setView((v) => {
      const next = clamp(k, 0.6, 4);
      // Keep the point under (cx, cy) fixed.
      return { k: next, x: cx - ((cx - v.x) / v.k) * next, y: cy - ((cy - v.y) / v.k) * next };
    });
  const labels = useMemo(
    () =>
      placeLabels(
        laid.map((l): LabelItem => ({ id: l.id, x: l.x, y: l.y, r: l.r, text: byId.get(l.id)?.label ?? l.id, priority: (byId.get(l.id)?.weight ?? 1) + (l.id === props.selected ? 1e6 : 0) })),
        { w: W, h: H },
        12 / view.k,
      ),
    [laid, props.selected, Math.round(view.k * 4)],
  );
  const connected = (id: string) => props.edges.filter((e) => e.source === id || e.target === id).length;
  const summary = `${props.nodes.length} nodes and ${props.edges.length} links. Solid blue links are ${words.supportive}, dashed orange links are ${words.opposed}, dotted grey links are ${words.mixed}. Circles are actors, squares are issues.`;
  const columns: Column[] = ["from", "to", "kind", "weight"].map((name) => ({ name, type: "VARCHAR" }));
  const pan = (dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  return (
    <figure class="pk-chart pk-visual pk-network">
      <figcaption>{props.caption}</figcaption>
      <div class="pk-network__tools" role="group" aria-label="Graph view">
        <button type="button" class="pk-button" onClick={() => zoomTo(view.k * 1.4)}>
          Zoom in
        </button>
        <button type="button" class="pk-button" onClick={() => zoomTo(view.k / 1.4)}>
          Zoom out
        </button>
        <button type="button" class="pk-button" onClick={() => setView({ k: 1, x: 0, y: 0 })}>
          Reset view
        </button>
        <span class="pk-network__hint">Drag to move. Arrow keys move, plus and minus zoom.</span>
      </div>
      <svg
        role="group"
        aria-label={`${props.caption}. ${summary}`}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        tabindex={0}
        class="pk-network__svg"
        onKeyDown={(e: KeyboardEvent) => {
          if ((e.target as Element).getAttribute("role") === "button") return;
          const step = 40;
          const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
          const m = moves[e.key];
          if (m) (e.preventDefault(), pan(m[0], m[1]));
          else if (e.key === "+" || e.key === "=") (e.preventDefault(), zoomTo(view.k * 1.25));
          else if (e.key === "-") (e.preventDefault(), zoomTo(view.k / 1.25));
          else if (e.key === "0") setView({ k: 1, x: 0, y: 0 });
        }}
        onWheel={(e: WheelEvent) => {
          e.preventDefault();
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          zoomTo(view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), ((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * H);
        }}
        onPointerDown={(e: PointerEvent) => {
          if ((e.target as Element).closest("[role=button]")) return;
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e: PointerEvent) => {
          const d = drag.current;
          if (!d) return;
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setView((v) => ({ ...v, x: d.vx + ((e.clientX - d.x) / box.width) * W, y: d.vy + ((e.clientY - d.y) / box.height) * H }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`} data-zoom={view.k.toFixed(2)}>
          {props.edges.map((e, i) => {
            const a = at.get(e.source);
            const b = at.get(e.target);
            if (!a || !b) return null;
            const faded = props.selected && !(e.source === props.selected || e.target === props.selected);
            return (
              <line
                key={i}
                class={`pk-edge ${POLARITY_CLASS[e.polarity]}${faded ? " pk-faded" : ""}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke-width={(1.5 + Math.min(4, (e.weight ?? 1) * 0.8)) / Math.sqrt(view.k)}
              />
            );
          })}
          {props.nodes.map((n) => {
            const p = at.get(n.id);
            if (!p) return null;
            const faded = props.selected && !near.has(n.id);
            const series = Math.max(0, groups.indexOf(n.group ?? "")) % 8;
            const label = labels.find((l) => l.id === n.id)!;
            const name = `${n.kind === "issue" ? "Issue" : "Actor"} ${n.label}, ${connected(n.id)} links${n.group ? `, ${n.group}` : ""}`;
            const mark =
              n.kind === "issue" ? (
                <rect class={`pk-node pk-node--issue pk-series-${series}`} x={p.x - p.r} y={p.y - p.r} width={p.r * 2} height={p.r * 2} rx="2" />
              ) : (
                <circle class={`pk-node pk-series-${series}`} cx={p.x} cy={p.y} r={p.r} />
              );
            const body = (
              <>
                {mark}
                {props.selected === n.id ? <circle class="pk-selected" cx={p.x} cy={p.y} r={p.r + 4} fill="none" /> : null}
                {label.shown ? (
                  <text class="pk-chart__label" x={label.x} y={label.y} text-anchor={label.anchor} dominant-baseline="middle" font-size={12 / view.k}>
                    {label.text}
                  </text>
                ) : null}
              </>
            );
            return props.onSelect ? (
              <g
                key={n.id}
                role="button"
                tabindex={0}
                aria-label={name}
                aria-pressed={props.selected === n.id}
                class={`pk-hit${faded ? " pk-faded" : ""}`}
                onClick={() => props.onSelect?.(n.id)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") (e.preventDefault(), props.onSelect?.(n.id));
                }}
              >
                {body}
              </g>
            ) : (
              <g key={n.id} class={faded ? "pk-faded" : undefined}>
                <title>{name}</title>
                {body}
              </g>
            );
          })}
        </g>
      </svg>
      <ul class="pk-legend" aria-label="Legend">
        {(["supportive", "opposed", "mixed"] as const).map((p) => (
          <li key={p}>
            <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true">
              <line class={`pk-edge ${POLARITY_CLASS[p]}`} x1="1" y1="5" x2="27" y2="5" stroke-width="3" />
            </svg>{" "}
            {words[p]}
          </li>
        ))}
      </ul>
      <p class="pk-visually-hidden">{summary}</p>
      <details class="pk-chart__data">
        <summary>View the data as a table</summary>
        <DataTable
          caption={`${props.caption}, as a table`}
          columns={columns}
          labels={{ from: "From", to: "To", kind: "Link", weight: "Weight" }}
          rows={props.edges.map((e) => ({ from: byId.get(e.source)?.label ?? e.source, to: byId.get(e.target)?.label ?? e.target, kind: words[e.polarity], weight: e.weight ?? 1 }))}
        />
      </details>
    </figure>
  );
}
