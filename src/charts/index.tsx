/** @jsxImportSource preact */
/**
 * Charts as hand-rolled SVG (portal-shell.md decision 8).
 *
 * - Geometry uses SVG presentation attributes; colour comes from CSS classes
 *   (`pk-series-N`) reading the theme's custom properties. No `style` attribute.
 * - Every chart is a <figure> with a caption and a one-sentence text summary, and
 *   a data table of the same rows beside it (closed on screen, open in print).
 * - Every bar carries its value as a direct label, so colour is never the only cue.
 * - Every mark has a card (interact.tsx): value, count, unit and denominator on hover,
 *   touch and keyboard focus. A suppressed figure appears nowhere: not on the bar, in
 *   the summary, the card or the table.
 * - Time charts can zoom (a local view) and brush (a reported range); legends toggle series.
 */

import { scaleBand, scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";
import { useId, useRef, useState } from "preact/hooks";

import type { Column } from "../contract/index.ts";
import { DataTable } from "../ui/index.tsx";
import { type MarkDetail, markHandlers, Plot, SeriesLegend, svgPoint, useBrushX, useMarks, useToggles, useZoomX, ZoomTools } from "./interact.tsx";

export interface BarDatum {
  label: string;
  value: number;
  series?: number;
  /** The count behind the value. */
  n?: number;
  caveat?: string;
  /** Withhold the figure (true, or the reason in words). */
  suppressed?: boolean | string;
}

export interface BarChartProps {
  caption: string;
  data: BarDatum[];
  /** How a value reads in words and labels, e.g. (v) => `${v}%`. */
  format?: (value: number) => string;
  valueLabel?: string;
  width?: number;
  /** What a value measures, for the card; null when it does not apply. */
  unit?: string | null;
  /** What a value is out of, for the card; null when it does not apply. */
  denominator?: string | null;
  /** Names of the `series` indices; when given, the legend toggles them. */
  seriesNames?: string[];
  /** The table's heading for the label column. */
  labelHeading?: string;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const WITHHELD = "withheld";

export function summarise(data: BarDatum[], format: (v: number) => string = fmt): string {
  const shown = data.filter((d) => !d.suppressed);
  if (data.length === 0) return "No values.";
  const hidden = data.length - shown.length;
  const tail = hidden ? ` ${hidden} withheld as too few to report.` : "";
  if (shown.length === 0) return `${data.length} values, all withheld as too few to report.`;
  const top = shown.reduce((a, b) => (b.value > a.value ? b : a));
  const bottom = shown.reduce((a, b) => (b.value < a.value ? b : a));
  // A diverging chart (values below zero) names both ends.
  const low = bottom.value < 0 ? `, lowest is ${bottom.label} at ${format(bottom.value)}` : "";
  return `${data.length} values; highest is ${top.label} at ${format(top.value)}${low}.${tail}`;
}

export function BarChart(props: BarChartProps) {
  const format = props.format ?? fmt;
  const width = props.width ?? 640;
  const [hidden, toggle] = useToggles();
  const data = props.data.filter((d) => !hidden.has(d.series ?? 0));
  const marks = useMarks(data.length);
  const rowHeight = 28;
  const labelWidth = Math.min(220, Math.round(width * 0.34));
  const height = Math.max(rowHeight, data.length * rowHeight);
  const shownValues = data.filter((d) => !d.suppressed).map((d) => d.value);
  const max = Math.max(0, ...shownValues);
  const min = Math.min(0, ...shownValues);
  // Values below zero diverge from a drawn zero line, with room on the left for their labels.
  const diverging = min < 0;
  const x = scaleLinear()
    .domain([min, max || (diverging ? 0 : 1)])
    .range([diverging ? 44 : 0, width - labelWidth - 56]);
  const zero = x(0);
  const barX = (v: number) => labelWidth + Math.min(x(v), zero);
  const barW = (v: number) => Math.max(1, Math.abs(x(v) - zero));
  const y = scaleBand<string>()
    .domain(data.map((d, i) => `${i}`))
    .range([0, height])
    .padding(0.25);
  const summary = summarise(props.data, format);
  const columns: Column[] = [
    { name: "label", type: "VARCHAR" },
    { name: "value", type: "DOUBLE" },
    ...(props.data.some((d) => d.n !== undefined) ? [{ name: "n", type: "INTEGER" }] : []),
  ];
  const detail = (d: BarDatum): MarkDetail => ({
    label: d.label,
    value: format(d.value),
    n: d.n ?? null,
    unit: props.unit ?? null,
    denominator: props.denominator ?? null,
    caveat: d.caveat,
    suppressed: d.suppressed,
  });
  const a = marks.active;
  const activeTop = a === null ? 0 : (y(`${a}`) ?? 0);
  return (
    <figure class="pk-chart">
      <figcaption>{props.caption}</figcaption>
      {props.seriesNames && props.seriesNames.length > 1 ? <SeriesLegend names={props.seriesNames} hidden={hidden} onToggle={toggle} /> : null}
      <Plot
        label={`Values of ${props.caption}`}
        marks={marks}
        detail={a === null ? null : detail(data[a]!)}
        at={a === null ? undefined : { x: labelWidth + (data[a]!.suppressed ? zero : x(data[a]!.value)), y: activeTop }}
        box={{ w: width, h: height }}
      >
        <svg
          role="img"
          aria-label={`${props.caption}. ${summary}`}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          preserveAspectRatio="xMinYMin meet"
        >
          {diverging ? <line class="pk-zero" x1={labelWidth + zero} x2={labelWidth + zero} y1={0} y2={height} /> : null}
          {data.map((d, i) => {
            const top = y(`${i}`) ?? 0;
            const band = y.bandwidth();
            return (
              <g key={`${d.label}-${i}`} transform={`translate(0 ${top})`} class={`pk-mark${a === i ? " pk-mark--on" : ""}`} {...markHandlers(i, marks)}>
                <rect class="pk-hit__area" x={0} y={-band * 0.15} width={width} height={band * 1.3} />
                <text class="pk-chart__label" x={labelWidth - 8} y={band / 2} text-anchor="end" dominant-baseline="middle">
                  {d.label}
                </text>
                {d.suppressed ? (
                  <text class="pk-chart__value pk-chart__value--withheld" x={labelWidth + 6} y={band / 2} dominant-baseline="middle">
                    {WITHHELD}
                  </text>
                ) : (
                  <>
                    <rect
                      class={`pk-series-${(d.series ?? 0) % 8}${d.value < 0 ? " pk-bar--neg" : ""}`}
                      x={barX(d.value)}
                      y={0}
                      width={barW(d.value)}
                      height={band}
                      rx={2}
                    />
                    <text
                      class="pk-chart__value"
                      x={d.value < 0 ? labelWidth + x(d.value) - 6 : labelWidth + x(d.value) + 6}
                      y={band / 2}
                      text-anchor={d.value < 0 ? "end" : undefined}
                      dominant-baseline="middle"
                    >
                      {format(d.value)}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </Plot>
      <p class="pk-visually-hidden">{summary}</p>
      <details class="pk-chart__data">
        <summary>View the data as a table</summary>
        <DataTable
          caption={props.caption}
          columns={columns}
          rows={props.data.map((d) => ({
            label: d.label,
            value: d.suppressed ? WITHHELD : format(d.value),
            ...(columns.length > 2 ? { n: d.suppressed ? WITHHELD : (d.n ?? "—") } : {}),
          }))}
          labels={{ label: props.labelHeading ?? "Item", value: props.valueLabel ?? "Value", n: "Count" }}
        />
      </details>
    </figure>
  );
}

export interface SeriesPoint {
  at: string; // ISO date
  value: number;
  /** The count behind the value. */
  n?: number;
  suppressed?: boolean | string;
}

export interface LineSeries {
  name: string;
  points: SeriesPoint[];
}

/** A range of dates the reader brushed, snapped to dates the chart has. */
export interface DateRange {
  from: string;
  to: string;
}

export interface LineChartProps {
  caption: string;
  series: LineSeries[];
  format?: (value: number) => string;
  width?: number;
  height?: number;
  unit?: string | null;
  denominator?: string | null;
  /** Zoom the time axis (a local view; nothing about the page's selection changes). */
  zoomable?: boolean;
  /** Let the reader brush a range; it is reported through `onRange`, never applied here. */
  brushable?: boolean;
  onRange?: (range: DateRange | null) => void;
}

/** The dates in [lo, hi] (ms) among `dates`, as the first and last; null when none fall inside. */
export function snapRange(dates: string[], lo: number, hi: number): DateRange | null {
  const inside = [...new Set(dates)].filter((d) => {
    const t = Date.parse(d);
    return t >= Math.min(lo, hi) && t <= Math.max(lo, hi);
  });
  inside.sort();
  return inside.length ? { from: inside[0]!, to: inside[inside.length - 1]! } : null;
}

export function LineChart(props: LineChartProps) {
  const format = props.format ?? fmt;
  const width = props.width ?? 640;
  const height = props.height ?? 220;
  const pad = { top: 12, right: 120, bottom: 24, left: 40 };
  const clip = useId();
  const svg = useRef<SVGSVGElement>(null);
  const brushG = useRef<SVGGElement>(null);
  const [hidden, toggle] = useToggles();
  const [range, setRangeState] = useState<DateRange | null>(null);
  const visible = props.series.map((s, i) => ({ s, i })).filter(({ i }) => !hidden.has(i));
  const all = props.series.flatMap((s) => s.points);
  const dates = [...new Set(all.map((p) => p.at))].sort();
  const times = dates.map((d) => Date.parse(d)).filter(Number.isFinite);
  const shownPoints = visible.flatMap(({ s }) => s.points.filter((p) => !p.suppressed));
  const max = Math.max(0, ...shownPoints.map((p) => p.value));
  const extent: [[number, number], [number, number]] = [
    [pad.left, pad.top],
    [width - pad.right, height - pad.bottom],
  ];
  const zoom = useZoomX(svg, { enabled: Boolean(props.zoomable), extent, pan: !props.brushable });
  const x0 = scaleTime()
    .domain([new Date(Math.min(...times)), new Date(Math.max(...times))])
    .range([pad.left, width - pad.right]);
  const x = zoom.t.rescaleX(x0);
  const y = scaleLinear()
    .domain([0, max || 1])
    .nice()
    .range([height - pad.bottom, pad.top]);
  // Suppressed points break the line rather than draw a withheld figure.
  const path = line<SeriesPoint>()
    .defined((p) => !p.suppressed)
    .x((p) => x(new Date(p.at)))
    .y((p) => y(p.value));
  const setRange = (r: DateRange | null) => {
    setRangeState(r);
    props.onRange?.(r);
  };
  const brush = useBrushX(brushG, {
    enabled: Boolean(props.brushable),
    extent,
    onEnd: (span) => {
      brush.clear();
      setRange(span ? snapRange(dates, x.invert(span[0]).getTime(), x.invert(span[1]).getTime()) : null);
    },
  });
  // The marks a card can open on: every point of every visible series, in date order.
  const points = visible
    .flatMap(({ s, i }) => s.points.map((p) => ({ p, s, i })))
    .sort((a, b) => a.p.at.localeCompare(b.p.at) || a.i - b.i);
  const marks = useMarks(points.length);
  const active = marks.active === null ? null : points[marks.active]!;
  const nearest = (e: Event) => {
    if (!svg.current || !points.length) return;
    const [px, py] = svgPoint(e, svg.current);
    let best = 0;
    let bestD = Infinity;
    points.forEach(({ p }, k) => {
      const d = Math.hypot(x(new Date(p.at)) - px, (p.suppressed ? y(0) : y(p.value)) - py);
      if (d < bestD) (bestD = d), (best = k);
    });
    marks.set(best);
  };
  const shownSeries = visible.length;
  const summary =
    props.series.length === 0
      ? "No values."
      : `${props.series.length} series over ${dates.length} dates; highest value ${format(max)}.${shownSeries < props.series.length ? ` ${props.series.length - shownSeries} hidden by the legend.` : ""}`;
  const columns: Column[] = [
    { name: "series", type: "VARCHAR" },
    { name: "at", type: "DATE" },
    { name: "value", type: "DOUBLE" },
  ];
  const idx = (d: string | undefined) => (d === undefined ? -1 : dates.indexOf(d));
  return (
    <figure class="pk-chart">
      <figcaption>{props.caption}</figcaption>
      {props.series.length > 1 ? <SeriesLegend names={props.series.map((s) => s.name)} hidden={hidden} onToggle={toggle} /> : null}
      {props.zoomable ? (
        <ZoomTools zoom={zoom} label={props.caption}>
          {props.brushable && range ? (
            <button type="button" class="pk-button" onClick={() => zoom.fit(x0(new Date(range.from)), x0(new Date(range.to)))}>
              Zoom to range
            </button>
          ) : null}
        </ZoomTools>
      ) : null}
      <Plot
        label={`Values of ${props.caption}`}
        marks={marks}
        onKey={zoom.onKey}
        detail={
          active
            ? {
                label: `${active.s.name}, ${active.p.at}`,
                value: format(active.p.value),
                n: active.p.n ?? null,
                unit: props.unit ?? null,
                denominator: props.denominator ?? null,
                suppressed: active.p.suppressed,
              }
            : null
        }
        at={active ? { x: x(new Date(active.p.at)), y: active.p.suppressed ? y(0) : y(active.p.value) } : undefined}
        box={{ w: width, h: height }}
      >
        <svg
          ref={svg}
          role="img"
          aria-label={`${props.caption}. ${summary}`}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          class={props.zoomable || props.brushable ? "pk-chart__zoomable" : undefined}
          data-zoom={zoom.t.k.toFixed(2)}
          onPointerMove={nearest}
          onPointerDown={(e: PointerEvent) => {
            if (e.pointerType !== "mouse") nearest(e);
          }}
        >
          <defs>
            <clipPath id={`${clip}-plot`}>
              <rect x={pad.left} y={0} width={width - pad.left - pad.right} height={height} />
            </clipPath>
          </defs>
          {y.ticks(4).map((t) => (
            <g key={t}>
              <line class="pk-chart__grid" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
              <text class="pk-chart__axis" x={pad.left - 6} y={y(t)} text-anchor="end" dominant-baseline="middle">
                {format(t)}
              </text>
            </g>
          ))}
          {range ? (
            <rect
              class="pk-range"
              data-range={`${range.from}/${range.to}`}
              clip-path={`url(#${clip}-plot)`}
              x={x(new Date(range.from)) - 3}
              y={pad.top}
              width={Math.max(6, x(new Date(range.to)) - x(new Date(range.from)) + 6)}
              height={height - pad.top - pad.bottom}
            />
          ) : null}
          <g clip-path={`url(#${clip}-plot)`}>
            {visible.map(({ s, i }) => (
              <path key={s.name} class={`pk-line pk-series-${i % 8}`} d={path(s.points) ?? ""} fill="none" />
            ))}
            {active && !active.p.suppressed ? <circle class={`pk-point pk-series-${active.i % 8}`} cx={x(new Date(active.p.at))} cy={y(active.p.value)} r={5} /> : null}
          </g>
          {visible.map(({ s, i }) => {
            const last = [...s.points].reverse().find((p) => !p.suppressed);
            const lx = last ? x(new Date(last.at)) : NaN;
            return last && lx >= pad.left - 0.5 && lx <= width - pad.right + 0.5 ? (
              <text key={s.name} class="pk-chart__label" x={lx + 6} y={y(last.value)} dominant-baseline="middle">
                {s.name}
              </text>
            ) : (
              <g key={s.name} data-series={i} />
            );
          })}
          <g ref={brushG} class="pk-brush" />
        </svg>
      </Plot>
      {props.brushable ? (
        <fieldset class="pk-range-controls">
          <legend>Range</legend>
          <label>
            From{" "}
            <input
              type="range"
              min={0}
              max={Math.max(0, dates.length - 1)}
              value={range ? idx(range.from) : 0}
              aria-valuetext={range ? range.from : "no range"}
              onInput={(e) => {
                const i = Number((e.currentTarget as HTMLInputElement).value);
                const to = range ? Math.max(i, idx(range.to)) : dates.length - 1;
                setRange({ from: dates[i]!, to: dates[to]! });
              }}
            />
          </label>
          <label>
            To{" "}
            <input
              type="range"
              min={0}
              max={Math.max(0, dates.length - 1)}
              value={range ? idx(range.to) : Math.max(0, dates.length - 1)}
              aria-valuetext={range ? range.to : "no range"}
              onInput={(e) => {
                const i = Number((e.currentTarget as HTMLInputElement).value);
                const from = range ? Math.min(i, idx(range.from)) : 0;
                setRange({ from: dates[from]!, to: dates[i]! });
              }}
            />
          </label>
          <output data-range-out>
            {range ? `${range.from} to ${range.to} (${idx(range.to) - idx(range.from) + 1} dates)` : "No range selected"}
          </output>
          <button type="button" class="pk-button" onClick={() => setRange(null)} disabled={!range}>
            Clear range
          </button>
        </fieldset>
      ) : null}
      <p class="pk-visually-hidden">{summary}</p>
      <details class="pk-chart__data">
        <summary>View the data as a table</summary>
        <DataTable
          caption={props.caption}
          columns={columns}
          rows={props.series.flatMap((s) => s.points.map((p) => ({ series: s.name, at: p.at, value: p.suppressed ? WITHHELD : format(p.value) })))}
          labels={{ series: "Series", at: "Date", value: "Value" }}
        />
      </details>
    </figure>
  );
}

/* ------------------------------------------------------------------ sparkline */

export interface SparklineProps {
  /** What the line counts, e.g. "Documents per week". */
  label: string;
  points: SeriesPoint[];
  format?: (value: number) => string;
  unit?: string | null;
  denominator?: string | null;
  width?: number;
  height?: number;
}

export function sparkSummary(label: string, points: SeriesPoint[], format: (v: number) => string = fmt): string {
  const shown = points.filter((p) => !p.suppressed);
  if (!shown.length) return `${label}: no values.`;
  const last = shown[shown.length - 1]!;
  const top = shown.reduce((a, b) => (b.value > a.value ? b : a));
  return `${label}: ${points.length} values from ${points[0]!.at} to ${points[points.length - 1]!.at}; latest ${format(last.value)}, highest ${format(top.value)} on ${top.at}.`;
}

/** A tile's small trend line: a labelled image whose points open a card. */
export function Sparkline(props: SparklineProps) {
  const format = props.format ?? fmt;
  const width = props.width ?? 120;
  const height = props.height ?? 32;
  const pts = [...props.points].sort((a, b) => a.at.localeCompare(b.at));
  const marks = useMarks(pts.length);
  const shown = pts.filter((p) => !p.suppressed);
  const times = pts.map((p) => Date.parse(p.at));
  const x = scaleTime()
    .domain([new Date(Math.min(...times)), new Date(Math.max(...times, Math.min(...times) + 1))])
    .range([3, width - 3]);
  const y = scaleLinear()
    .domain([0, Math.max(1, ...shown.map((p) => p.value))])
    .range([height - 3, 3]);
  const path = line<SeriesPoint>()
    .defined((p) => !p.suppressed)
    .x((p) => x(new Date(p.at)))
    .y((p) => y(p.value));
  const summary = sparkSummary(props.label, pts, format);
  const a = marks.active === null ? null : pts[marks.active]!;
  const last = shown[shown.length - 1];
  return (
    <div class="pk-spark">
      <Plot
        label={props.label}
        marks={marks}
        detail={a ? { label: `${props.label}, ${a.at}`, value: format(a.value), n: a.n ?? null, unit: props.unit ?? null, denominator: props.denominator ?? null, suppressed: a.suppressed } : null}
        at={a ? { x: x(new Date(a.at)), y: a.suppressed ? y(0) : y(a.value) } : undefined}
        box={{ w: width, h: height }}
      >
        <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
          <path class="pk-line pk-spark__line" d={path(pts) ?? ""} fill="none" />
          {pts.map((p, i) => (
            <rect
              key={p.at}
              class="pk-hit__area"
              x={x(new Date(p.at)) - width / Math.max(2, pts.length) / 2}
              y={0}
              width={width / Math.max(2, pts.length)}
              height={height}
              {...markHandlers(i, marks)}
            />
          ))}
          {last ? <circle class="pk-spark__last" cx={x(new Date(last.at))} cy={y(last.value)} r={2.5} /> : null}
          {a && !a.suppressed ? <circle class="pk-point pk-series-0" cx={x(new Date(a.at))} cy={y(a.value)} r={3} /> : null}
        </svg>
      </Plot>
    </div>
  );
}
