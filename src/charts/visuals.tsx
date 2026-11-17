/** @jsxImportSource preact */
/**
 * The rich visuals of the V2 design (dashboard-content.md sections 4 and 11), as
 * hand-written SVG: stance matrix, voice-by-alignment quadrant, stage ladder, vote
 * hemicycle and story swimlanes. Rules every one of them follows:
 *
 * - a <figure> with a caption and a one-sentence summary, and the same rows as a data
 *   table beside it (closed on screen, open in print);
 * - stance is blue (for) against orange (against), grey for mixed, and always paired with
 *   a polarity glyph or a shape, so colour is never the only cue;
 * - two-axis charts draw their zero lines and name them;
 * - labels are placed so none overlaps another or a mark (layout.ts); a label that fits
 *   nowhere is left to the table and the mark's accessible name;
 * - geometry is SVG attributes and colour is CSS classes: no `style` attribute anywhere;
 * - a mark is interactive only when its handler is given, and then it is a keyboard
 *   button with a name, never a bare pointer target.
 */

import { scaleLinear, scaleTime } from "d3-scale";
import type { ComponentChildren, Ref } from "preact";
import { useId, useRef } from "preact/hooks";

import type { Column } from "../contract/index.ts";
import { DataTable } from "../ui/index.tsx";
import { type MarkDetail, type Marks, markHandlers, Plot, useMarks, useZoomX, ZoomTools } from "./interact.tsx";
import { followsInApp, hemicycleSeats, type LabelItem, placeLabels, wrapLabel } from "./layout.ts";

type Polarity = "supportive" | "opposed" | "mixed";

function Frame(props: {
  caption: string;
  summary: string;
  interactive: boolean;
  viewBox: string;
  children: ComponentChildren;
  table: { columns: Column[]; rows: Array<Record<string, unknown>>; labels?: Record<string, string> };
  legend?: ComponentChildren;
  /** The mark card: which mark is active and what it says. */
  card?: { marks: Marks; detail: MarkDetail | null; at?: { x: number; y: number } };
  tools?: ComponentChildren;
  svgRef?: Ref<SVGSVGElement>;
  onKey?: (e: KeyboardEvent) => boolean;
  zoom?: number;
}) {
  const [, , w, h] = props.viewBox.split(" ").map(Number);
  const svg = (
    <svg
      ref={props.svgRef}
      role={props.interactive ? "group" : "img"}
      aria-label={`${props.caption}. ${props.summary}`}
      viewBox={props.viewBox}
      width="100%"
      preserveAspectRatio="xMinYMin meet"
      class={props.zoom !== undefined ? "pk-chart__zoomable" : undefined}
      data-zoom={props.zoom?.toFixed(2)}
    >
      {props.children}
    </svg>
  );
  return (
    <figure class="pk-chart pk-visual">
      <figcaption>{props.caption}</figcaption>
      {props.tools}
      {props.card ? (
        <Plot
          label={`Values of ${props.caption}`}
          marks={props.card.marks}
          detail={props.card.detail}
          at={props.card.at}
          box={{ w: w ?? 1, h: h ?? 1 }}
          focusable={!props.interactive}
          onKey={props.onKey}
        >
          {svg}
        </Plot>
      ) : (
        svg
      )}
      {props.legend}
      <p class="pk-visually-hidden">{props.summary}</p>
      <details class="pk-chart__data">
        <summary>View the data as a table</summary>
        <DataTable caption={`${props.caption}, as a table`} columns={props.table.columns} rows={props.table.rows} labels={props.table.labels} />
      </details>
    </figure>
  );
}

/** A keyboard-reachable SVG button. */
/**
 * One selectable mark. With `href` it is a link (an entity's page: it reloads, opens in a new
 * tab and is shared); a plain click still navigates in the app through `onActivate`. Without
 * one it is a button that changes the page (a filter).
 */
function Hit(props: {
  label: string;
  onActivate: () => void;
  pressed?: boolean;
  href?: string;
  children: ComponentChildren;
  class?: string;
  handlers?: ReturnType<typeof markHandlers>;
}) {
  const cls = `pk-hit${props.pressed ? " pk-hit--on" : ""}${props.class ? ` ${props.class}` : ""}`;
  if (props.href)
    return (
      <a
        {...props.handlers}
        href={props.href}
        aria-label={props.label}
        aria-current={props.pressed ? "true" : undefined}
        class={cls}
        onClick={(e: MouseEvent) => {
          if (!followsInApp(e)) return;
          e.preventDefault();
          props.onActivate();
        }}
      >
        {props.children}
      </a>
    );
  return (
    <g
      {...props.handlers}
      role="button"
      tabindex={0}
      aria-label={props.label}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed}
      class={cls}
      onClick={props.onActivate}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onActivate();
        }
      }}
    >
      {props.children}
    </g>
  );
}

/** What a mark's label says it does: open a page (a link) or the details (a button). */
const opens = (href: string | undefined) => (href ? "open its page" : "open details");

const col = (name: string): Column => ({ name, type: "VARCHAR" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Legend({ items }: { items: Array<{ cls: string; glyph: string; text: string }> }) {
  return (
    <ul class="pk-legend" aria-label="Legend">
      {items.map((i) => (
        <li key={i.text}>
          <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
            <circle class={i.cls} r="7" />
            <text class="pk-glyph" text-anchor="middle" dominant-baseline="central">
              {i.glyph}
            </text>
          </svg>{" "}
          {i.text}
        </li>
      ))}
    </ul>
  );
}

const STANCE_LEGEND = [
  { cls: "pk-stance pk-sup", glyph: "+", text: "For" },
  { cls: "pk-stance pk-opp", glyph: "−", text: "Against" },
  { cls: "pk-stance pk-mix", glyph: "±", text: "Mixed or unclear" },
];

/* ---------------------------------------------------------------- stance matrix */

export interface StanceCell {
  row: string;
  col: string;
  n: number;
  supportive?: number;
  opposed?: number;
  mixed?: number;
  latest?: string;
}

export interface StanceMatrixProps {
  caption: string;
  rows: Array<{ id: string; label: string; group?: string }>;
  cols: Array<{ id: string; label: string }>;
  cells: StanceCell[];
  selectedRow?: string;
  selectedCol?: string;
  onRow?: (id: string) => void;
  onCol?: (id: string) => void;
  /** Where a row's actor and a column's issue have their pages; the marks are then links. */
  rowHref?: (id: string) => string;
  colHref?: (id: string) => string;
  onCell?: (row: string, col: string) => void;
  /** What a cell's count is out of, for the card; null when it does not apply. */
  denominator?: string | null;
}

/** The stance a cell shows: for, against, or mixed when the sides are close or only mixed. */
export function stanceOf(cell: Pick<StanceCell, "supportive" | "opposed" | "mixed">): Polarity {
  const s = cell.supportive ?? 0;
  const o = cell.opposed ?? 0;
  const m = cell.mixed ?? 0;
  const total = s + o + m;
  if (!total) return "mixed";
  const net = (s - o) / total;
  return net > 0.25 ? "supportive" : net < -0.25 ? "opposed" : "mixed";
}

const GLYPH: Record<Polarity, string> = { supportive: "+", opposed: "−", mixed: "±" };
const POLARITY_CLASS: Record<Polarity, string> = { supportive: "pk-sup", opposed: "pk-opp", mixed: "pk-mix" };
const POLARITY_WORD: Record<Polarity, string> = { supportive: "for", opposed: "against", mixed: "mixed" };

export function StanceMatrix(props: StanceMatrixProps) {
  const interactive = Boolean(props.onRow || props.onCol || props.onCell);
  const rows = [...props.rows].sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label));
  const cellW = 92;
  const rowH = 46;
  const labelW = 176;
  const headLines = props.cols.map((c) => wrapLabel(c.label, 13));
  const headH = Math.max(...headLines.map((l) => l.length), 1) * 14 + 18;
  const groupH = 22;
  let y = headH;
  const laid = rows.map((row, i) => {
    const newGroup = row.group !== undefined && row.group !== rows[i - 1]?.group;
    if (newGroup) y += groupH;
    const top = y;
    y += rowH;
    return { row, top, newGroup };
  });
  const width = labelW + props.cols.length * cellW + 8;
  const height = y + 4;
  const byKey = new Map(props.cells.map((c) => [`${c.row}\u0000${c.col}`, c]));
  const rowLabel = (id: string) => rows.find((r) => r.id === id)?.label ?? id;
  const colLabel = (id: string) => props.cols.find((c) => c.id === id)?.label ?? id;
  const summary = `${plural(props.cells.length, "position")} from ${plural(rows.length, "actor")} on ${plural(props.cols.length, "issue")}. Blue with a plus is for, orange with a minus is against, grey with a plus-minus is mixed; a bigger dot means more statements.`;
  // The cards follow the drawn order: row by row, then column by column.
  const order = laid.flatMap(({ row, top }) =>
    props.cols.flatMap((c, ci) => {
      const cell = byKey.get(`${row.id}\u0000${c.id}`);
      return cell ? [{ cell, row, c, cx: labelW + ci * cellW + cellW / 2, cy: top + rowH / 2 }] : [];
    }),
  );
  const marks = useMarks(order.length);
  const on = marks.active === null ? null : order[marks.active]!;
  const index = new Map(order.map((o, i) => [`${o.row.id}\u0000${o.c.id}`, i]));
  return (
    <Frame
      caption={props.caption}
      summary={summary}
      interactive={interactive}
      viewBox={`0 0 ${width} ${height}`}
      legend={<Legend items={STANCE_LEGEND} />}
      card={{
        marks,
        detail: on
          ? {
              label: `${on.row.label} on ${on.c.label}`,
              value: `${POLARITY_WORD[stanceOf(on.cell)]}: ${on.cell.supportive ?? 0} for, ${on.cell.opposed ?? 0} against, ${on.cell.mixed ?? 0} mixed${on.cell.latest ? `; latest ${on.cell.latest}` : ""}`,
              n: on.cell.n,
              unit: "statements",
              denominator: props.denominator ?? null,
            }
          : null,
        at: on ? { x: on.cx, y: on.cy - 12 } : undefined,
      }}
      table={{
        columns: ["actor", "issue", "for", "against", "mixed", "statements", "latest"].map(col),
        labels: { actor: "Actor", issue: "Issue", for: "For", against: "Against", mixed: "Mixed", statements: "Statements", latest: "Latest" },
        rows: props.cells.map((c) => ({
          actor: rowLabel(c.row),
          issue: colLabel(c.col),
          for: c.supportive ?? 0,
          against: c.opposed ?? 0,
          mixed: c.mixed ?? 0,
          statements: c.n,
          latest: c.latest ?? "—",
        })),
      }}
    >
      {props.cols.map((c, ci) => {
        const x = labelW + ci * cellW + cellW / 2;
        const head = (
          <>
            {headLines[ci]!.map((line, li, all) => (
              <text key={li} class="pk-chart__label" x={x} y={14 + li * 14} text-anchor="middle">
                {li < all.length - 1 ? `${line} ` : line}
              </text>
            ))}
            {props.selectedCol === c.id ? <rect class="pk-selected" x={x - cellW / 2 + 2} y={0} width={cellW - 4} height={headH - 6} fill="none" rx="4" /> : null}
          </>
        );
        return props.onCol ? (
          <Hit key={c.id} label={`Issue ${c.label}: ${opens(props.colHref?.(c.id))}`} pressed={props.selectedCol === c.id} href={props.colHref?.(c.id)} onActivate={() => props.onCol?.(c.id)}>
            <rect x={x - cellW / 2 + 2} y={0} width={cellW - 4} height={headH - 6} class="pk-hit__area" />
            {head}
          </Hit>
        ) : (
          <g key={c.id}>{head}</g>
        );
      })}
      {laid.map(({ row, top, newGroup }) => (
        <g key={row.id}>
          {newGroup ? (
            <text class="pk-chart__axis pk-chart__group" x={0} y={top - groupH + 14}>
              {row.group}
            </text>
          ) : null}
          <line class="pk-chart__grid" x1={0} x2={width} y1={top + rowH} y2={top + rowH} />
          {(() => {
            const label = (
              <text class="pk-chart__label" x={labelW - 10} y={top + rowH / 2} text-anchor="end" dominant-baseline="middle">
                {wrapLabel(row.label, 24, 1)[0]}
              </text>
            );
            return props.onRow ? (
              <Hit label={`Actor ${row.label}: ${opens(props.rowHref?.(row.id))}`} pressed={props.selectedRow === row.id} href={props.rowHref?.(row.id)} onActivate={() => props.onRow?.(row.id)}>
                <rect x={0} y={top} width={labelW - 4} height={rowH} class="pk-hit__area" />
                {label}
              </Hit>
            ) : (
              label
            );
          })()}
          {props.cols.map((c, ci) => {
            const cell = byKey.get(`${row.id}\u0000${c.id}`);
            if (!cell) return null;
            const polarity = stanceOf(cell);
            const r = Math.min(19, 7 + Math.sqrt(cell.n) * 4);
            const cx = labelW + ci * cellW + cellW / 2;
            const mark = (
              <>
                <circle class={`pk-stance ${POLARITY_CLASS[polarity]}`} cx={cx} cy={top + rowH / 2} r={r} />
                <text class="pk-glyph" x={cx} y={top + rowH / 2} text-anchor="middle" dominant-baseline="central">
                  {GLYPH[polarity]}
                </text>
              </>
            );
            const name = `${row.label} on ${c.label}: ${POLARITY_WORD[polarity]}, ${plural(cell.n, "statement")}`;
            const handlers = markHandlers(index.get(`${row.id}\u0000${c.id}`) ?? 0, marks);
            return props.onCell ? (
              <Hit key={c.id} label={name} onActivate={() => props.onCell?.(row.id, c.id)} handlers={handlers}>
                {mark}
              </Hit>
            ) : (
              <g key={c.id} class="pk-mark" {...handlers}>
                {mark}
              </g>
            );
          })}
        </g>
      ))}
    </Frame>
  );
}

/* ------------------------------------------------------------------- quadrant */

export interface QuadrantPoint {
  id: string;
  label: string;
  /** Alignment with the engagement's position, from -1 (against) to +1 (for); null when unknown. */
  alignment: number | null;
  /** Share of the voice, 0 to 1. */
  voice: number;
  n?: number;
  group?: string;
}

export interface QuadrantProps {
  caption: string;
  points: QuadrantPoint[];
  selected?: string;
  onSelect?: (id: string) => void;
  /** Where a point's actor has its page; the marks are then links. */
  href?: (id: string) => string;
  groups?: string[];
  /** The horizontal scale, low to high (default -1 to +1: alignment). Zero is drawn and named. */
  xDomain?: [number, number];
  /** What the axes and corners say (default: voice against alignment). */
  words?: Partial<QuadrantWords>;
  /** What the voice share is out of, for the card; null when it does not apply. */
  denominator?: string | null;
}

/** The words a quadrant uses; the defaults read voice against alignment. */
export interface QuadrantWords {
  /** The horizontal axis title. */
  axis: string;
  /** Under the low end, zero and the high end of the horizontal axis. */
  low: string;
  zero: string;
  high: string;
  /** Top-left, top-right, bottom-left, bottom-right. */
  corners: [string, string, string, string];
  /** A point's side, in words: below, near and above zero. */
  sides: [string, string, string];
  /** The horizontal measure in the card and the table heading. */
  xName: string;
  xHeading: string;
  /** The vertical measure: "of the voice" after a percentage, and its table heading. */
  yOf: string;
  yHeading: string;
  /** What a point is ("actor") and what places it, for the summary. */
  placedBy: string;
  /** The summary's closing sentence (default: voice is not influence). */
  footnote: string;
  /** A point with no horizontal value, in the table. */
  missing: string;
}

const VOICE_WORDS: QuadrantWords = {
  axis: "Alignment with the engagement's position",
  low: "−1 against",
  zero: "Neutral",
  high: "+1 for",
  corners: ["Loud opponents", "Loud allies", "Quiet opponents", "Quiet allies"],
  sides: ["against", "neutral", "for"],
  xName: "alignment",
  xHeading: "Alignment (-1 to +1)",
  yOf: "of the voice",
  yHeading: "Voice",
  placedBy: "how much voice they have and which way they lean",
  footnote: "This measures voice, not influence.",
  missing: "no stance",
};

export function Quadrant(props: QuadrantProps) {
  const width = 640;
  const height = 400;
  const pad = { top: 24, right: 24, bottom: 48, left: 56 };
  const w: QuadrantWords = { ...VOICE_WORDS, ...props.words };
  const [lo, hi] = props.xDomain ?? [-1, 1];
  const plotted = props.points.filter((p) => typeof p.alignment === "number");
  const unplotted = props.points.filter((p) => typeof p.alignment !== "number");
  const maxVoice = Math.max(0.1, ...props.points.map((p) => p.voice));
  const x = scaleLinear().domain([lo, hi]).range([pad.left, width - pad.right]).clamp(true);
  const y = scaleLinear()
    .domain([0, Math.min(1, Math.ceil(maxVoice * 10) / 10)])
    .range([height - pad.bottom, pad.top]);
  const groups = props.groups ?? [...new Set(plotted.map((p) => p.group ?? ""))];
  const maxN = Math.max(1, ...plotted.map((p) => p.n ?? 1));
  const radius = (p: QuadrantPoint) => 6 + Math.sqrt((p.n ?? 1) / maxN) * 10;
  const placed = placeLabels(
    plotted.map((p): LabelItem => ({ id: p.id, x: x(p.alignment!), y: y(p.voice), r: radius(p), text: p.label, priority: p.voice })),
    { w: width, h: height - pad.bottom + 8 },
  );
  const near = 0.025 * (hi - lo);
  const side = (p: QuadrantPoint) => ((p.alignment ?? 0) > near ? w.sides[2] : (p.alignment ?? 0) < -near ? w.sides[0] : w.sides[1]);
  const summary = `${plural(plotted.length, "actor")} placed by ${w.placedBy}${unplotted.length ? `; ${plural(unplotted.length, "entry", "entries")} with ${w.missing} is listed in the table only` : ""}. ${w.footnote}`;
  const y0 = y.domain()[1]!;
  const marks = useMarks(plotted.length);
  const on = marks.active === null ? null : plotted[marks.active]!;
  return (
    <Frame
      caption={props.caption}
      summary={summary}
      interactive={Boolean(props.onSelect)}
      viewBox={`0 0 ${width} ${height}`}
      card={{
        marks,
        detail: on
          ? {
              label: on.label,
              value: `${Math.round(on.voice * 100)}% ${w.yOf}; ${w.xName} ${on.alignment!.toFixed(2)} (${side(on)})`,
              n: on.n ?? null,
              unit: `share ${w.yOf}`,
              denominator: props.denominator ?? null,
            }
          : null,
        at: on ? { x: x(on.alignment!), y: y(on.voice) - radius(on) } : undefined,
      }}
      table={{
        columns: ["actor", "group", "alignment", "voice", "statements"].map(col),
        labels: { actor: "Actor", group: "Group", alignment: w.xHeading, voice: w.yHeading, statements: "Statements" },
        rows: props.points.map((p) => ({
          actor: p.label,
          group: p.group ?? "—",
          alignment: p.alignment === null ? w.missing : p.alignment.toFixed(2),
          voice: `${Math.round(p.voice * 100)}%`,
          statements: p.n ?? "—",
        })),
      }}
    >
      <rect class="pk-quad pk-quad--for" x={x(0)} y={pad.top} width={x(hi) - x(0)} height={y(y0 / 2) - pad.top} />
      <rect class="pk-quad pk-quad--against" x={x(lo)} y={pad.top} width={x(0) - x(lo)} height={y(y0 / 2) - pad.top} />
      {y.ticks(4).map((t) => (
        <g key={t}>
          <line class="pk-chart__grid" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
          <text class="pk-chart__axis" x={pad.left - 8} y={y(t)} text-anchor="end" dominant-baseline="middle">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
      {/* The zero line of alignment, drawn heavy and named. */}
      <line class="pk-zero" x1={x(0)} x2={x(0)} y1={pad.top} y2={height - pad.bottom} />
      <line class="pk-zero" x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} />
      <text class="pk-chart__axis" x={x(0)} y={height - pad.bottom + 16} text-anchor="middle">
        {w.zero}
      </text>
      <text class="pk-chart__axis" x={pad.left} y={height - pad.bottom + 16}>
        {w.low}
      </text>
      <text class="pk-chart__axis" x={width - pad.right} y={height - pad.bottom + 16} text-anchor="end">
        {w.high}
      </text>
      <text class="pk-chart__axis" x={(pad.left + width - pad.right) / 2} y={height - 8} text-anchor="middle">
        {w.axis}
      </text>
      <text class="pk-chart__axis" x={pad.left + 4} y={pad.top + 12}>
        {w.corners[0]}
      </text>
      <text class="pk-chart__axis" x={width - pad.right - 4} y={pad.top + 12} text-anchor="end">
        {w.corners[1]}
      </text>
      <text class="pk-chart__axis" x={pad.left + 4} y={height - pad.bottom - 6}>
        {w.corners[2]}
      </text>
      <text class="pk-chart__axis" x={width - pad.right - 4} y={height - pad.bottom - 6} text-anchor="end">
        {w.corners[3]}
      </text>
      {plotted.map((p, i) => {
        const label = placed[i]!;
        const series = Math.max(0, groups.indexOf(p.group ?? "")) % 8;
        const name = `${p.label}: ${side(p)}, ${Math.round(p.voice * 100)}% ${w.yOf}`;
        const mark = (
          <>
            <circle class={`pk-series-${series} pk-bubble`} cx={x(p.alignment!)} cy={y(p.voice)} r={radius(p)} />
            {props.selected === p.id ? <circle class="pk-selected" cx={x(p.alignment!)} cy={y(p.voice)} r={radius(p) + 4} fill="none" /> : null}
            {label.shown ? (
              <text class="pk-chart__label" x={label.x} y={label.y} text-anchor={label.anchor} dominant-baseline="middle">
                {label.text}
              </text>
            ) : null}
          </>
        );
        return props.onSelect ? (
          <Hit key={p.id} label={name} pressed={props.selected === p.id} href={props.href?.(p.id)} onActivate={() => props.onSelect?.(p.id)} handlers={markHandlers(i, marks)}>
            {mark}
          </Hit>
        ) : (
          <g key={p.id} class="pk-mark" {...markHandlers(i, marks)}>
            {mark}
          </g>
        );
      })}
    </Frame>
  );
}

/* -------------------------------------------------------------- stage ladder */

export interface StageLadderProps {
  caption: string;
  steps: string[];
  /** 1-based step the bill is at; 0 or beyond the last means unplaced. */
  current: number;
  stopped?: boolean;
  onStep?: (step: number) => void;
}

export function stageStatus(index: number, current: number): "done" | "current" | "next" | "later" {
  const step = index + 1;
  return step < current ? "done" : step === current ? "current" : step === current + 1 ? "next" : "later";
}

const STAGE_WORD = { done: "Done", current: "Now", next: "Next", later: "Later" } as const;

export function StageLadder(props: StageLadderProps) {
  const gap = 118;
  const width = Math.max(320, props.steps.length * gap + 24);
  const lineY = 34;
  const lines = props.steps.map((s) => wrapLabel(s, 15));
  const height = lineY + 30 + Math.max(...lines.map((l) => l.length), 1) * 14 + 8;
  const summary = props.current > 0 ? `Step ${props.current} of ${props.steps.length}: ${props.steps[props.current - 1] ?? "unknown"}.${props.steps[props.current] ? ` Next: ${props.steps[props.current]}.` : ""}${props.stopped ? " The bill has stopped." : ""}` : "The bill's stage is not placed on the ladder.";
  const cx = (i: number) => 12 + gap / 2 + i * gap;
  return (
    <Frame
      caption={props.caption}
      summary={summary}
      interactive={Boolean(props.onStep)}
      viewBox={`0 0 ${width} ${height}`}
      table={{
        columns: ["step", "name", "status"].map(col),
        labels: { step: "Step", name: "Stage", status: "Status" },
        rows: props.steps.map((s, i) => ({ step: i + 1, name: s, status: STAGE_WORD[stageStatus(i, props.current)] })),
      }}
    >
      <line class="pk-ladder__rail" x1={cx(0)} x2={cx(props.steps.length - 1)} y1={lineY} y2={lineY} />
      <line class="pk-ladder__done" x1={cx(0)} x2={cx(Math.max(0, props.current - 1))} y1={lineY} y2={lineY} />
      {props.steps.map((s, i) => {
        const status = stageStatus(i, props.current);
        const mark = (
          <>
            <circle class={`pk-ladder__dot pk-ladder__dot--${status}`} cx={cx(i)} cy={lineY} r={status === "current" ? 13 : 10} />
            <text class="pk-glyph" x={cx(i)} y={lineY} text-anchor="middle" dominant-baseline="central">
              {status === "done" ? "✓" : String(i + 1)}
            </text>
            <text class={`pk-chart__axis pk-ladder__state pk-ladder__state--${status}`} x={cx(i)} y={lineY - 20} text-anchor="middle">
              {status === "current" ? (props.stopped ? "Stopped here" : "Now") : status === "next" ? "Next" : ""}
            </text>
            {lines[i]!.map((line, li) => (
              <text key={li} class="pk-chart__label" x={cx(i)} y={lineY + 30 + li * 14} text-anchor="middle">
                {line}
              </text>
            ))}
          </>
        );
        return props.onStep ? (
          <Hit key={s} label={`Step ${i + 1}, ${s}: ${STAGE_WORD[status]}`} onActivate={() => props.onStep?.(i + 1)}>
            {mark}
          </Hit>
        ) : (
          <g key={s}>
            <title>{`Step ${i + 1}, ${s}: ${STAGE_WORD[status]}`}</title>
            {mark}
          </g>
        );
      })}
    </Frame>
  );
}

/* ----------------------------------------------------------------- hemicycle */

export type Vote = "for" | "against" | "abstain" | "absent";

export interface Faction {
  label: string;
  seats: number;
  vote: Vote;
}

export interface HemicycleProps {
  caption: string;
  factions: Faction[];
  outcome?: string;
}

const VOTE_CLASS: Record<Vote, string> = { for: "pk-sup", against: "pk-opp", abstain: "pk-mix", absent: "pk-none" };
const VOTE_WORD: Record<Vote, string> = { for: "For", against: "Against", abstain: "Abstained", absent: "Did not vote" };
const VOTE_GLYPH: Record<Vote, string> = { for: "+", against: "−", abstain: "±", absent: "·" };

export function Hemicycle(props: HemicycleProps) {
  const total = props.factions.reduce((a, f) => a + f.seats, 0);
  const seats = hemicycleSeats(total);
  const radius = 150;
  const dot = Math.max(3.2, Math.min(9, 150 / Math.max(6, Math.sqrt(total) * 2.4)));
  // Seats run left to right, factions in the order given; the seat shape repeats the vote.
  const owner: Faction[] = props.factions.flatMap((f) => Array.from({ length: f.seats }, () => f));
  const tally = (v: Vote) => props.factions.filter((f) => f.vote === v).reduce((a, f) => a + f.seats, 0);
  const summary = `${total} seats: ${tally("for")} for, ${tally("against")} against, ${tally("abstain")} abstained, ${tally("absent")} did not vote${props.outcome ? `. Outcome: ${props.outcome}` : ""}.`;
  const legendH = 8;
  return (
    <Frame
      caption={props.caption}
      summary={summary}
      interactive={false}
      viewBox={`-${radius + 14} -${radius + 14} ${(radius + 14) * 2} ${radius + 14 + 40 + legendH}`}
      legend={
        <ul class="pk-legend" aria-label="Seats by faction">
          {props.factions.map((f) => (
            <li key={f.label}>
              <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
                <circle class={`pk-stance ${VOTE_CLASS[f.vote]}`} r="7" />
                <text class="pk-glyph" text-anchor="middle" dominant-baseline="central">
                  {VOTE_GLYPH[f.vote]}
                </text>
              </svg>{" "}
              {f.label}: {f.seats} seats, {VOTE_WORD[f.vote].toLowerCase()}
            </li>
          ))}
        </ul>
      }
      table={{
        columns: ["faction", "seats", "vote"].map(col),
        labels: { faction: "Faction", seats: "Seats", vote: "Vote" },
        rows: props.factions.map((f) => ({ faction: f.label, seats: f.seats, vote: VOTE_WORD[f.vote] })),
      }}
    >
      {seats.map(([sx, sy], i) => {
        const f = owner[i]!;
        const cx = sx * radius;
        const cy = sy * radius;
        const cls = `pk-stance ${VOTE_CLASS[f.vote]}`;
        return f.vote === "against" ? (
          <rect key={i} class={cls} x={cx - dot} y={cy - dot} width={dot * 2} height={dot * 2} />
        ) : f.vote === "abstain" ? (
          <polygon key={i} class={cls} points={`${cx},${cy - dot * 1.2} ${cx + dot * 1.2},${cy} ${cx},${cy + dot * 1.2} ${cx - dot * 1.2},${cy}`} />
        ) : (
          <circle key={i} class={cls} cx={cx} cy={cy} r={dot} />
        );
      })}
      <text class="pk-chart__value" x={0} y={-6} text-anchor="middle">
        {`${tally("for")} for · ${tally("against")} against`}
      </text>
      {props.outcome ? (
        <text class="pk-chart__axis" x={0} y={14} text-anchor="middle">
          {props.outcome}
        </text>
      ) : null}
    </Frame>
  );
}

/* ----------------------------------------------------------------- swimlanes */

export interface LaneEvent {
  id: string;
  /** ISO date. */
  at: string;
  /** How big the day was (documents); sizes the dot. */
  size?: number;
  /** An event (vote, postponement) is drawn as a diamond, a day of coverage as a dot. */
  kind?: "coverage" | "event";
  label?: string;
}

export interface Lane {
  id: string;
  label: string;
  events: LaneEvent[];
}

export interface SwimlanesProps {
  caption: string;
  lanes: Lane[];
  selected?: string;
  onLane?: (id: string) => void;
  /** Where a lane's story has its page; the lane labels are then links. */
  laneHref?: (id: string) => string;
  onEvent?: (lane: string, event: string) => void;
  /** Zoom and pan the time axis (a local view). */
  zoomable?: boolean;
}

const DAY = 86_400_000;

export function Swimlanes(props: SwimlanesProps) {
  const width = 720;
  const labelW = 190;
  const laneH = 56;
  const axisH = 30;
  const dates = props.lanes.flatMap((l) => l.events.map((e) => Date.parse(e.at))).filter(Number.isFinite);
  const lo = dates.length ? Math.min(...dates) : Date.now();
  const hi = dates.length ? Math.max(...dates) : Date.now();
  const span = Math.max(hi - lo, 2 * DAY);
  const maxSize = Math.max(1, ...props.lanes.flatMap((l) => l.events.map((e) => e.size ?? 1)));
  const height = props.lanes.length * laneH + axisH + 6;
  const svg = useRef<SVGSVGElement>(null);
  const clip = useId();
  const zoom = useZoomX(svg, { enabled: Boolean(props.zoomable), extent: [[labelW + 8, 0], [width - 16, height]], pan: true });
  const x = zoom.t.rescaleX(
    scaleTime()
      .domain([new Date(lo - span * 0.06), new Date(hi + span * 0.06)])
      .range([labelW + 8, width - 16]),
  );
  const order = props.lanes.flatMap((lane, li) => lane.events.map((e) => ({ lane, e, li })));
  const marks = useMarks(order.length);
  const on = marks.active === null ? null : order[marks.active]!;
  const pos = new Map(order.map((o, i) => [`${o.lane.id}\u0000${o.e.id}`, i]));
  const fmt = (d: Date) => d.toISOString().slice(5, 10);
  const ticks = x.ticks(Math.min(6, Math.max(2, Math.round(span / DAY / 2 / zoom.t.k) + 1)));
  const summary = `${plural(props.lanes.length, "story", "stories")} over ${Math.max(1, Math.round((hi - lo) / DAY) + 1)} days. Dots are days of coverage, sized by documents; diamonds above the line are events such as votes or postponements.`;
  const kindOf = (e: LaneEvent) => (e.kind === "event" ? "event" : "coverage");
  return (
    <Frame
      caption={props.caption}
      summary={summary}
      interactive={Boolean(props.onLane || props.onEvent)}
      viewBox={`0 0 ${width} ${height}`}
      svgRef={svg}
      zoom={props.zoomable ? zoom.t.k : undefined}
      onKey={zoom.onKey}
      tools={props.zoomable ? <ZoomTools zoom={zoom} label={props.caption} /> : undefined}
      card={{
        marks,
        detail: on
          ? {
              label: `${on.lane.label}, ${on.e.at}`,
              value: on.e.kind === "event" ? `event: ${on.e.label ?? "unnamed"}` : `${plural(on.e.size ?? 1, "document")} of coverage${on.e.label ? `; ${on.e.label}` : ""}`,
              n: on.e.size ?? null,
              unit: "documents",
              denominator: null,
            }
          : null,
        at: on ? { x: x(new Date(on.e.at)), y: on.li * laneH + laneH / 2 - 14 } : undefined,
      }}
      legend={
        <ul class="pk-legend" aria-label="Legend">
          <li>
            <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
              <circle class="pk-series-0" r="6" />
            </svg>{" "}
            Day of coverage
          </li>
          <li>
            <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
              <polygon class="pk-series-2" points="0,-7 7,0 0,7 -7,0" />
            </svg>{" "}
            Event
          </li>
        </ul>
      }
      table={{
        columns: ["story", "date", "kind", "size", "what"].map(col),
        labels: { story: "Story", date: "Date", kind: "Kind", size: "Documents", what: "What" },
        rows: props.lanes.flatMap((l) =>
          l.events.map((e) => ({ story: l.label, date: e.at, kind: kindOf(e) === "event" ? "Event" : "Coverage", size: e.size ?? "—", what: e.label ?? "—" })),
        ),
      }}
    >
      <defs>
        <clipPath id={`${clip}-lanes`}>
          <rect x={labelW} y={0} width={width - labelW} height={height} />
        </clipPath>
      </defs>
      {props.lanes.map((lane, li) => {
        const top = li * laneH;
        const mid = top + laneH / 2;
        const head = (
          <>
            <rect x={0} y={top + 2} width={labelW - 8} height={laneH - 4} class="pk-hit__area" />
            <text class="pk-chart__label" x={labelW - 14} y={mid} text-anchor="end" dominant-baseline="middle">
              {wrapLabel(lane.label, 26, 2).map((line, i, all) => (
                <tspan key={i} x={labelW - 14} dy={i === 0 ? (all.length > 1 ? "-0.55em" : "0") : "1.1em"}>
                  {i < all.length - 1 ? `${line} ` : line}
                </tspan>
              ))}
            </text>
            {props.selected === lane.id ? <rect class="pk-selected" x={1} y={top + 3} width={labelW - 10} height={laneH - 6} fill="none" rx="4" /> : null}
          </>
        );
        return (
          <g key={lane.id}>
            <line class="pk-chart__grid" x1={labelW} x2={width - 8} y1={mid} y2={mid} />
            {props.onLane ? (
              <Hit label={`Story ${lane.label}: ${opens(props.laneHref?.(lane.id))}`} pressed={props.selected === lane.id} href={props.laneHref?.(lane.id)} onActivate={() => props.onLane?.(lane.id)}>
                {head}
              </Hit>
            ) : (
              head
            )}
            <g clip-path={`url(#${clip}-lanes)`}>
            {lane.events.map((e) => {
              const cx = x(new Date(e.at));
              const r = 5 + Math.sqrt((e.size ?? 1) / maxSize) * 7;
              const isEvent = kindOf(e) === "event";
              const name = `${lane.label}, ${e.at}: ${isEvent ? "event" : "coverage"}${e.size ? `, ${plural(e.size, "document")}` : ""}${e.label ? `, ${e.label}` : ""}`;
              const mark = isEvent ? (
                <polygon class="pk-series-2 pk-event" points={`${cx},${mid - 21 - 7} ${cx + 7},${mid - 21} ${cx},${mid - 21 + 7} ${cx - 7},${mid - 21}`} />
              ) : (
                <circle class="pk-series-0 pk-bubble" cx={cx} cy={mid} r={r} />
              );
              const handlers = markHandlers(pos.get(`${lane.id}\u0000${e.id}`) ?? 0, marks);
              return props.onEvent ? (
                <Hit key={e.id} label={name} onActivate={() => props.onEvent?.(lane.id, e.id)} handlers={handlers}>
                  {mark}
                </Hit>
              ) : (
                <g key={e.id} class="pk-mark" {...handlers}>
                  {mark}
                </g>
              );
            })}
            </g>
          </g>
        );
      })}
      <line class="pk-zero" x1={labelW} x2={width - 8} y1={props.lanes.length * laneH + 2} y2={props.lanes.length * laneH + 2} />
      {ticks.filter((t) => x(t) >= labelW && x(t) <= width - 8).map((t) => (
        <text key={t.getTime()} class="pk-chart__axis" x={x(t)} y={props.lanes.length * laneH + 20} text-anchor="middle">
          {fmt(t)}
        </text>
      ))}
    </Frame>
  );
}
