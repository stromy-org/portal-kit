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
import type { ComponentChildren } from "preact";

import type { Column } from "../contract/index.ts";
import { DataTable } from "../ui/index.tsx";
import { hemicycleSeats, type LabelItem, placeLabels, wrapLabel } from "./layout.ts";

type Polarity = "supportive" | "opposed" | "mixed";

function Frame(props: {
  caption: string;
  summary: string;
  interactive: boolean;
  viewBox: string;
  children: ComponentChildren;
  table: { columns: Column[]; rows: Array<Record<string, unknown>>; labels?: Record<string, string> };
  legend?: ComponentChildren;
}) {
  return (
    <figure class="pk-chart pk-visual">
      <figcaption>{props.caption}</figcaption>
      <svg
        role={props.interactive ? "group" : "img"}
        aria-label={`${props.caption}. ${props.summary}`}
        viewBox={props.viewBox}
        width="100%"
        preserveAspectRatio="xMinYMin meet"
      >
        {props.children}
      </svg>
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
function Hit(props: { label: string; onActivate: () => void; pressed?: boolean; children: ComponentChildren; class?: string }) {
  return (
    <g
      role="button"
      tabindex={0}
      aria-label={props.label}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed}
      class={`pk-hit${props.pressed ? " pk-hit--on" : ""}${props.class ? ` ${props.class}` : ""}`}
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
  onCell?: (row: string, col: string) => void;
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
  return (
    <Frame
      caption={props.caption}
      summary={summary}
      interactive={interactive}
      viewBox={`0 0 ${width} ${height}`}
      legend={<Legend items={STANCE_LEGEND} />}
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
            {headLines[ci]!.map((line, li) => (
              <text key={li} class="pk-chart__label" x={x} y={14 + li * 14} text-anchor="middle">
                {line}
              </text>
            ))}
            {props.selectedCol === c.id ? <rect class="pk-selected" x={x - cellW / 2 + 2} y={0} width={cellW - 4} height={headH - 6} fill="none" rx="4" /> : null}
          </>
        );
        return props.onCol ? (
          <Hit key={c.id} label={`Issue ${c.label}: open details`} pressed={props.selectedCol === c.id} onActivate={() => props.onCol?.(c.id)}>
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
              <Hit label={`Actor ${row.label}: open details`} pressed={props.selectedRow === row.id} onActivate={() => props.onRow?.(row.id)}>
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
            return props.onCell ? (
              <Hit key={c.id} label={name} onActivate={() => props.onCell?.(row.id, c.id)}>
                {mark}
              </Hit>
            ) : (
              <g key={c.id}>
                <title>{name}</title>
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
  groups?: string[];
}

export function Quadrant(props: QuadrantProps) {
  const width = 640;
  const height = 400;
  const pad = { top: 24, right: 24, bottom: 48, left: 56 };
  const plotted = props.points.filter((p) => typeof p.alignment === "number");
  const unplotted = props.points.filter((p) => typeof p.alignment !== "number");
  const maxVoice = Math.max(0.1, ...props.points.map((p) => p.voice));
  const x = scaleLinear().domain([-1, 1]).range([pad.left, width - pad.right]);
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
  const side = (p: QuadrantPoint) => ((p.alignment ?? 0) > 0.05 ? "for" : (p.alignment ?? 0) < -0.05 ? "against" : "neutral");
  const summary = `${plural(plotted.length, "actor")} placed by how much voice they have and which way they lean${unplotted.length ? `; ${plural(unplotted.length, "entry", "entries")} with no stance is listed in the table only` : ""}. This measures voice, not influence.`;
  const y0 = y.domain()[1]!;
  return (
    <Frame
      caption={props.caption}
      summary={summary}
      interactive={Boolean(props.onSelect)}
      viewBox={`0 0 ${width} ${height}`}
      table={{
        columns: ["actor", "group", "alignment", "voice", "statements"].map(col),
        labels: { actor: "Actor", group: "Group", alignment: "Alignment (-1 to +1)", voice: "Voice", statements: "Statements" },
        rows: props.points.map((p) => ({
          actor: p.label,
          group: p.group ?? "—",
          alignment: p.alignment === null ? "no stance" : p.alignment.toFixed(2),
          voice: `${Math.round(p.voice * 100)}%`,
          statements: p.n ?? "—",
        })),
      }}
    >
      <rect class="pk-quad pk-quad--for" x={x(0)} y={pad.top} width={x(1) - x(0)} height={y(y0 / 2) - pad.top} />
      <rect class="pk-quad pk-quad--against" x={x(-1)} y={pad.top} width={x(0) - x(-1)} height={y(y0 / 2) - pad.top} />
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
        Neutral
      </text>
      <text class="pk-chart__axis" x={pad.left} y={height - pad.bottom + 16}>
        −1 against
      </text>
      <text class="pk-chart__axis" x={width - pad.right} y={height - pad.bottom + 16} text-anchor="end">
        +1 for
      </text>
      <text class="pk-chart__axis" x={(pad.left + width - pad.right) / 2} y={height - 8} text-anchor="middle">
        Alignment with the engagement's position
      </text>
      <text class="pk-chart__axis" x={pad.left + 4} y={pad.top + 12}>
        Loud opponents
      </text>
      <text class="pk-chart__axis" x={width - pad.right - 4} y={pad.top + 12} text-anchor="end">
        Loud allies
      </text>
      <text class="pk-chart__axis" x={pad.left + 4} y={height - pad.bottom - 6}>
        Quiet opponents
      </text>
      <text class="pk-chart__axis" x={width - pad.right - 4} y={height - pad.bottom - 6} text-anchor="end">
        Quiet allies
      </text>
      {plotted.map((p, i) => {
        const label = placed[i]!;
        const series = Math.max(0, groups.indexOf(p.group ?? "")) % 8;
        const name = `${p.label}: ${side(p)}, ${Math.round(p.voice * 100)}% of the voice`;
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
          <Hit key={p.id} label={name} pressed={props.selected === p.id} onActivate={() => props.onSelect?.(p.id)}>
            {mark}
          </Hit>
        ) : (
          <g key={p.id}>
            <title>{name}</title>
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
  onEvent?: (lane: string, event: string) => void;
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
  const x = scaleTime()
    .domain([new Date(lo - span * 0.06), new Date(hi + span * 0.06)])
    .range([labelW + 8, width - 16]);
  const maxSize = Math.max(1, ...props.lanes.flatMap((l) => l.events.map((e) => e.size ?? 1)));
  const height = props.lanes.length * laneH + axisH + 6;
  const fmt = (d: Date) => d.toISOString().slice(5, 10);
  const ticks = x.ticks(Math.min(6, Math.max(2, Math.round(span / DAY / 2))));
  const summary = `${plural(props.lanes.length, "story", "stories")} over ${Math.max(1, Math.round((hi - lo) / DAY) + 1)} days. Dots are days of coverage, sized by documents; diamonds are events such as votes or postponements.`;
  const kindOf = (e: LaneEvent) => (e.kind === "event" ? "event" : "coverage");
  return (
    <Frame
      caption={props.caption}
      summary={summary}
      interactive={Boolean(props.onLane || props.onEvent)}
      viewBox={`0 0 ${width} ${height}`}
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
      {props.lanes.map((lane, li) => {
        const top = li * laneH;
        const mid = top + laneH / 2;
        const head = (
          <>
            <rect x={0} y={top + 2} width={labelW - 8} height={laneH - 4} class="pk-hit__area" />
            <text class="pk-chart__label" x={labelW - 14} y={mid} text-anchor="end" dominant-baseline="middle">
              {wrapLabel(lane.label, 26, 2).map((line, i, all) => (
                <tspan key={i} x={labelW - 14} dy={i === 0 ? (all.length > 1 ? "-0.55em" : "0") : "1.1em"}>
                  {line}
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
              <Hit label={`Story ${lane.label}: open details`} pressed={props.selected === lane.id} onActivate={() => props.onLane?.(lane.id)}>
                {head}
              </Hit>
            ) : (
              head
            )}
            {lane.events.map((e) => {
              const cx = x(new Date(e.at));
              const r = 5 + Math.sqrt((e.size ?? 1) / maxSize) * 7;
              const isEvent = kindOf(e) === "event";
              const name = `${lane.label}, ${e.at}: ${isEvent ? "event" : "coverage"}${e.size ? `, ${plural(e.size, "document")}` : ""}${e.label ? `, ${e.label}` : ""}`;
              const mark = isEvent ? (
                <polygon class="pk-series-2 pk-event" points={`${cx},${mid - r - 2} ${cx + r + 2},${mid} ${cx},${mid + r + 2} ${cx - r - 2},${mid}`} />
              ) : (
                <circle class="pk-series-0 pk-bubble" cx={cx} cy={mid} r={r} />
              );
              return props.onEvent ? (
                <Hit key={e.id} label={name} onActivate={() => props.onEvent?.(lane.id, e.id)}>
                  {mark}
                </Hit>
              ) : (
                <g key={e.id}>
                  <title>{name}</title>
                  {mark}
                </g>
              );
            })}
          </g>
        );
      })}
      <line class="pk-zero" x1={labelW} x2={width - 8} y1={props.lanes.length * laneH + 2} y2={props.lanes.length * laneH + 2} />
      {ticks.map((t) => (
        <text key={t.getTime()} class="pk-chart__axis" x={x(t)} y={props.lanes.length * laneH + 20} text-anchor="middle">
          {fmt(t)}
        </text>
      ))}
    </Frame>
  );
}
