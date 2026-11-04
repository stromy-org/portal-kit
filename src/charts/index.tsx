/** @jsxImportSource preact */
/**
 * Charts as hand-rolled SVG (portal-shell.md decision 8).
 *
 * - Geometry uses SVG presentation attributes; colour comes from CSS classes
 *   (`pk-series-N`) reading the theme's custom properties. No `style` attribute.
 * - Every chart is a <figure> with a caption and a one-sentence text summary, and
 *   a data table of the same rows beside it (closed on screen, open in print).
 * - Every bar carries its value as a direct label, so colour is never the only cue.
 */

import { scaleBand, scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";

import type { Column } from "../contract/index.ts";
import { DataTable } from "../ui/index.tsx";

export interface BarDatum {
  label: string;
  value: number;
  series?: number;
}

export interface BarChartProps {
  caption: string;
  data: BarDatum[];
  /** How a value reads in words and labels, e.g. (v) => `${v}%`. */
  format?: (value: number) => string;
  valueLabel?: string;
  width?: number;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function summarise(data: BarDatum[], format: (v: number) => string = fmt): string {
  if (data.length === 0) return "No values.";
  const top = data.reduce((a, b) => (b.value > a.value ? b : a));
  return `${data.length} values; highest is ${top.label} at ${format(top.value)}.`;
}

export function BarChart(props: BarChartProps) {
  const format = props.format ?? fmt;
  const width = props.width ?? 640;
  const rowHeight = 28;
  const labelWidth = Math.min(220, Math.round(width * 0.34));
  const height = Math.max(rowHeight, props.data.length * rowHeight);
  const max = Math.max(0, ...props.data.map((d) => d.value));
  const x = scaleLinear()
    .domain([0, max || 1])
    .range([0, width - labelWidth - 56]);
  const y = scaleBand<string>()
    .domain(props.data.map((d, i) => `${i}`))
    .range([0, height])
    .padding(0.25);
  const summary = summarise(props.data, format);
  const columns: Column[] = [
    { name: "label", type: "VARCHAR" },
    { name: "value", type: "DOUBLE" },
  ];
  return (
    <figure class="pk-chart">
      <figcaption>{props.caption}</figcaption>
      <svg
        role="img"
        aria-label={`${props.caption}. ${summary}`}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        preserveAspectRatio="xMinYMin meet"
      >
        {props.data.map((d, i) => {
          const top = y(`${i}`) ?? 0;
          const band = y.bandwidth();
          return (
            <g key={`${d.label}-${i}`} transform={`translate(0 ${top})`}>
              <text class="pk-chart__label" x={labelWidth - 8} y={band / 2} text-anchor="end" dominant-baseline="middle">
                {d.label}
              </text>
              <rect class={`pk-series-${(d.series ?? 0) % 8}`} x={labelWidth} y={0} width={Math.max(1, x(d.value))} height={band} rx={2} />
              <text class="pk-chart__value" x={labelWidth + x(d.value) + 6} y={band / 2} dominant-baseline="middle">
                {format(d.value)}
              </text>
            </g>
          );
        })}
      </svg>
      <p class="pk-visually-hidden">{summary}</p>
      <details class="pk-chart__data">
        <summary>View the data as a table</summary>
        <DataTable
          caption={props.caption}
          columns={columns}
          rows={props.data.map((d) => ({ label: d.label, value: format(d.value) }))}
          labels={{ label: "", value: props.valueLabel ?? "Value" }}
        />
      </details>
    </figure>
  );
}

export interface SeriesPoint {
  at: string; // ISO date
  value: number;
}

export interface LineSeries {
  name: string;
  points: SeriesPoint[];
}

export interface LineChartProps {
  caption: string;
  series: LineSeries[];
  format?: (value: number) => string;
  width?: number;
  height?: number;
}

export function LineChart(props: LineChartProps) {
  const format = props.format ?? fmt;
  const width = props.width ?? 640;
  const height = props.height ?? 220;
  const pad = { top: 12, right: 120, bottom: 24, left: 40 };
  const all = props.series.flatMap((s) => s.points);
  const times = all.map((p) => Date.parse(p.at)).filter(Number.isFinite);
  const max = Math.max(0, ...all.map((p) => p.value));
  const x = scaleTime()
    .domain([new Date(Math.min(...times)), new Date(Math.max(...times))])
    .range([pad.left, width - pad.right]);
  const y = scaleLinear()
    .domain([0, max || 1])
    .nice()
    .range([height - pad.bottom, pad.top]);
  const path = line<SeriesPoint>()
    .x((p) => x(new Date(p.at)))
    .y((p) => y(p.value));
  const summary =
    props.series.length === 0
      ? "No values."
      : `${props.series.length} series over ${new Set(all.map((p) => p.at)).size} dates; highest value ${format(max)}.`;
  const columns: Column[] = [
    { name: "series", type: "VARCHAR" },
    { name: "at", type: "DATE" },
    { name: "value", type: "DOUBLE" },
  ];
  return (
    <figure class="pk-chart">
      <figcaption>{props.caption}</figcaption>
      <svg role="img" aria-label={`${props.caption}. ${summary}`} viewBox={`0 0 ${width} ${height}`} width="100%">
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line class="pk-chart__grid" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
            <text class="pk-chart__axis" x={pad.left - 6} y={y(t)} text-anchor="end" dominant-baseline="middle">
              {format(t)}
            </text>
          </g>
        ))}
        {props.series.map((s, i) => {
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.name}>
              <path class={`pk-line pk-series-${i % 8}`} d={path(s.points) ?? ""} fill="none" />
              {last && (
                <text class="pk-chart__label" x={x(new Date(last.at)) + 6} y={y(last.value)} dominant-baseline="middle">
                  {s.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p class="pk-visually-hidden">{summary}</p>
      <details class="pk-chart__data">
        <summary>View the data as a table</summary>
        <DataTable
          caption={props.caption}
          columns={columns}
          rows={props.series.flatMap((s) => s.points.map((p) => ({ series: s.name, at: p.at, value: format(p.value) })))}
          labels={{ series: "Series", at: "Date", value: "Value" }}
        />
      </details>
    </figure>
  );
}
