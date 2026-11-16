/** @jsxImportSource preact */
/**
 * The shared interaction layer every chart uses (ORG-PLAN-605 KIT), so hover, focus, touch,
 * zoom, brush and legend toggles behave the same everywhere.
 *
 * - Mark card: the value, the count behind it, its unit and its denominator, each either
 *   given or explicitly "not applicable", plus a caveat. A suppressed mark shows why it is
 *   hidden and never its figure. The card opens on pointer hover, on a touch tap and on
 *   keyboard focus (arrow keys step through the marks), closes on Escape or on leaving,
 *   and is a polite live region so a screen reader hears what a sighted reader sees.
 * - Zoom (d3-zoom) is a local viewport change on a time axis: buttons, + / - / 0 keys,
 *   ctrl- or cmd-wheel and pinch. A plain wheel is never captured, so the page scrolls.
 * - Brush (d3-brush) selects a range by pointer or touch; native range inputs select the
 *   same range from the keyboard. The range is reported, never applied: what a committed
 *   range means for the page's selection is the consumer's decision.
 * - Legend toggles are real buttons with aria-pressed; a hidden series stays in the table.
 *
 * CSP: d3 writes attributes and CSSOM properties (style.setProperty), never a `style`
 * attribute, `cssText` or eval; card positions are custom properties set the same way.
 * Every d3 listener is removed on rerender and unmount.
 */

import { brushX, type BrushBehavior } from "d3-brush";
import { pointer, select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";

/* ------------------------------------------------------------------ mark cards */

export interface MarkDetail {
  label: string;
  /** The value as the chart formats it. */
  value?: string;
  /** The count behind the value (statements, documents); null when it does not apply. */
  n?: number | null;
  /** What the value measures, e.g. "share of statements"; null when it does not apply. */
  unit?: string | null;
  /** What the value is out of, e.g. "all statements in the period"; null when it does not apply. */
  denominator?: string | null;
  caveat?: string;
  /** True, or the reason in words: the figure is withheld and never shown. */
  suppressed?: boolean | string;
}

const NA = "not applicable";

/** The card's lines, in order. A suppressed mark says why and shows no figure. */
export function detailLines(d: MarkDetail): string[] {
  if (d.suppressed) {
    const why = typeof d.suppressed === "string" ? d.suppressed : "too few to report";
    return [d.label, `Not shown: ${why}`, ...(d.caveat ? [d.caveat] : [])];
  }
  return [
    d.label,
    `Value: ${d.value ?? NA}`,
    `Count: ${typeof d.n === "number" ? String(d.n) : NA}`,
    `Unit: ${d.unit ?? NA}`,
    `Out of: ${d.denominator ?? NA}`,
    ...(d.caveat ? [d.caveat] : []),
  ];
}

export interface Marks {
  active: number | null;
  set: (i: number | null) => void;
  /** Arrow keys, Home and End step through the marks; Escape closes the card. */
  onKeyDown: (e: KeyboardEvent) => boolean;
}

export function useMarks(count: number): Marks {
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (active !== null && active >= count) setActive(null);
  }, [count]);
  const step = (delta: number) => setActive((a) => (count ? (a === null ? (delta > 0 ? 0 : count - 1) : (a + delta + count) % count) : null));
  return {
    active: active !== null && active < count ? active : null,
    set: setActive,
    onKeyDown(e) {
      const k = e.key;
      if (k === "Escape") return setActive(null), true;
      if (k === "ArrowRight" || k === "ArrowDown") return step(1), true;
      if (k === "ArrowLeft" || k === "ArrowUp") return step(-1), true;
      if (k === "Home") return setActive(count ? 0 : null), true;
      if (k === "End") return setActive(count ? count - 1 : null), true;
      return false;
    },
  };
}

/** Pointer, touch and focus handlers for one mark. */
export function markHandlers(i: number, marks: Marks) {
  return {
    onPointerEnter: () => marks.set(i),
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.pointerType === "pen") marks.set(i);
    },
    onFocus: () => marks.set(i),
  };
}

export interface PlotProps {
  /** Words for the keyboard reader, e.g. "Values of Share of voice". */
  label: string;
  detail: MarkDetail | null;
  /** Where the card points, in the SVG's viewBox units. */
  at?: { x: number; y: number };
  box: { w: number; h: number };
  marks: Marks;
  /** When the marks are buttons themselves, the plot is not a separate tab stop. */
  focusable?: boolean;
  /** Extra keys (zoom); return true when handled. */
  onKey?: (e: KeyboardEvent) => boolean;
  children: ComponentChildren;
}

/** The wrapper every chart's SVG sits in: the keyboard tab stop and the mark card. */
export function Plot(props: PlotProps) {
  const id = useId();
  const tip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tip.current;
    if (!el || !props.at) return;
    el.style.setProperty("--pk-tip-x", `${(props.at.x / props.box.w) * 100}%`);
    el.style.setProperty("--pk-tip-y", `${(props.at.y / props.box.h) * 100}%`);
  }, [props.at?.x, props.at?.y, props.box.w, props.box.h, props.detail]);
  const lines = props.detail ? detailLines(props.detail) : [];
  const focusable = props.focusable ?? true;
  // Keep the card inside the figure: below the mark near the top, anchored inward near an edge.
  const fx = props.at ? props.at.x / props.box.w : 0.5;
  const fy = props.at ? props.at.y / props.box.h : 1;
  const place = `${fy < 0.4 ? " pk-tip--below" : ""}${fx < 0.25 ? " pk-tip--start" : fx > 0.75 ? " pk-tip--end" : ""}`;
  return (
    <div
      class="pk-plot"
      role={focusable ? "group" : undefined}
      aria-label={focusable ? `${props.label}: use the arrow keys to read each value` : undefined}
      aria-describedby={focusable ? `${id}-tip` : undefined}
      tabindex={focusable ? 0 : undefined}
      onKeyDown={(e: KeyboardEvent) => {
        if (props.onKey?.(e) || (focusable || e.key === "Escape" ? props.marks.onKeyDown(e) : false)) e.preventDefault();
      }}
      onPointerLeave={(e: PointerEvent) => {
        if (e.pointerType === "mouse") props.marks.set(null);
      }}
      onFocusOut={(e: FocusEvent) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !(e.currentTarget as HTMLElement).contains(next)) props.marks.set(null);
      }}
    >
      {props.children}
      <div ref={tip} id={`${id}-tip`} class={`pk-tip${props.detail ? place : " pk-tip--off"}`} role="status" aria-live="polite">
        {lines.map((line, i) =>
          i === 0 ? (
            <strong key={i} class="pk-tip__title">
              {line}
            </strong>
          ) : (
            <span key={i} class="pk-tip__line">
              {line}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- legend toggles */

export interface SeriesLegendProps {
  names: string[];
  hidden: ReadonlySet<number>;
  onToggle: (index: number) => void;
  /** CSS class per series swatch; defaults to the kit's series palette. */
  swatch?: (index: number) => string;
}

/** One pressed button per series; pressing hides or shows it. */
export function SeriesLegend(props: SeriesLegendProps) {
  return (
    <ul class="pk-legend pk-legend--toggles" aria-label="Series: press to hide or show">
      {props.names.map((name, i) => {
        const shown = !props.hidden.has(i);
        return (
          <li key={`${i}-${name}`}>
            <button type="button" class="pk-legend__toggle" aria-pressed={shown} onClick={() => props.onToggle(i)}>
              <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">
                <rect class={props.swatch?.(i) ?? `pk-series-${i % 8}`} x="1" y="1" width="16" height="8" rx="2" />
              </svg>{" "}
              {name}
              <span class="pk-visually-hidden">{shown ? " (shown)" : " (hidden)"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function useToggles(): [ReadonlySet<number>, (i: number) => void] {
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  return [
    hidden,
    (i) =>
      setHidden((h) => {
        const next = new Set(h);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      }),
  ];
}

/* ------------------------------------------------------------------------ zoom */

export type Extent = [[number, number], [number, number]];

export interface ZoomX {
  t: ZoomTransform;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** Pan by viewBox units (positive moves the content right). */
  panBy: (dx: number) => void;
  /** Fit the viewBox span [x0, x1] (in unzoomed units) to the plot's width. */
  fit: (x0: number, x1: number) => void;
  /** + / - / 0 and shift-arrows; returns true when handled. */
  onKey: (e: KeyboardEvent) => boolean;
}

const MAX_SCALE = 20;

/**
 * Horizontal zoom on an SVG with d3-zoom. Wheel zoom needs ctrl or cmd (a plain wheel
 * scrolls the page); a pinch always zooms; a one-pointer drag pans only when `pan` is set
 * (a brushed chart keeps the drag for its brush).
 */
export function useZoomX(svg: RefObject<SVGSVGElement | null>, options: { enabled: boolean; extent: Extent; pan: boolean }): ZoomX {
  const [t, setT] = useState<ZoomTransform>(zoomIdentity);
  const behaviour = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [[x0, y0], [x1, y1]] = options.extent;
  useEffect(() => {
    const node = svg.current;
    if (!options.enabled || !node) return;
    const z = zoom<SVGSVGElement, unknown>()
      .extent(options.extent)
      .translateExtent(options.extent)
      .scaleExtent([1, MAX_SCALE])
      .filter((e: Event) => {
        if (e.type === "wheel") return (e as WheelEvent).ctrlKey || (e as WheelEvent).metaKey;
        if (e.type.startsWith("touch")) return options.pan || ((e as TouchEvent).touches?.length ?? 0) > 1;
        return options.pan && !(e as MouseEvent).button && !(e as MouseEvent).ctrlKey;
      })
      .on("zoom", (e: { transform: ZoomTransform }) => setT(e.transform));
    const sel = select(node);
    sel.call(z).on("dblclick.zoom", null);
    behaviour.current = z;
    return () => {
      z.on("zoom", null);
      sel.on(".zoom", null);
      behaviour.current = null;
    };
  }, [options.enabled, options.pan, x0, y0, x1, y1]);
  const run = (f: (z: ZoomBehavior<SVGSVGElement, unknown>, s: ReturnType<typeof select<SVGSVGElement, unknown>>) => void) => {
    const z = behaviour.current;
    if (z && svg.current) f(z, select(svg.current));
  };
  const api: ZoomX = {
    t,
    zoomIn: () => run((z, s) => z.scaleBy(s, 1.5)),
    zoomOut: () => run((z, s) => z.scaleBy(s, 1 / 1.5)),
    reset: () => run((z, s) => z.transform(s, zoomIdentity)),
    panBy: (dx) => run((z, s) => z.translateBy(s, dx / t.k, 0)),
    fit: (a, b) =>
      run((z, s) => {
        const k = Math.min(MAX_SCALE, Math.max(1, (x1 - x0) / Math.max(1e-6, b - a)));
        z.transform(s, zoomIdentity.translate(x0 - k * a, 0).scale(k));
      }),
    onKey(e) {
      if (!options.enabled) return false;
      if (e.key === "+" || e.key === "=") return api.zoomIn(), true;
      if (e.key === "-" || e.key === "_") return api.zoomOut(), true;
      if (e.key === "0") return api.reset(), true;
      if (e.shiftKey && e.key === "ArrowLeft") return api.panBy(40), true;
      if (e.shiftKey && e.key === "ArrowRight") return api.panBy(-40), true;
      return false;
    },
  };
  return api;
}

export function ZoomTools(props: { zoom: ZoomX; label: string; children?: ComponentChildren }) {
  return (
    <div class="pk-chart__tools" role="group" aria-label={`${props.label}: view`}>
      <button type="button" class="pk-button" onClick={props.zoom.zoomIn}>
        Zoom in
      </button>
      <button type="button" class="pk-button" onClick={props.zoom.zoomOut} disabled={props.zoom.t.k <= 1}>
        Zoom out
      </button>
      <button type="button" class="pk-button" onClick={props.zoom.reset} disabled={props.zoom.t.k === 1 && props.zoom.t.x === 0}>
        Reset view
      </button>
      {props.children}
      <span class="pk-chart__hint">Ctrl or cmd and the wheel, or + and −, zoom; shift and the arrows move.</span>
    </div>
  );
}

/* ----------------------------------------------------------------------- brush */

/**
 * A horizontal d3-brush in the `<g>` the ref points at. `onEnd` gets the brushed span in
 * viewBox units, or null when the brush was cleared by the reader. Programmatic moves do
 * not call it.
 */
export function useBrushX(g: RefObject<SVGGElement | null>, options: { enabled: boolean; extent: Extent; onEnd: (span: [number, number] | null) => void }) {
  const onEnd = useRef(options.onEnd);
  onEnd.current = options.onEnd;
  const behaviour = useRef<BrushBehavior<unknown> | null>(null);
  const [[x0, y0], [x1, y1]] = options.extent;
  useEffect(() => {
    const node = g.current;
    if (!options.enabled || !node) return;
    const b = brushX<unknown>()
      .extent(options.extent)
      .on("end", (e: { selection: [number, number] | null; sourceEvent?: Event }) => {
        if (!e.sourceEvent) return;
        onEnd.current(e.selection);
      });
    const sel = select(node);
    sel.call(b);
    behaviour.current = b;
    return () => {
      b.on("end", null);
      sel.on(".brush", null);
      sel.selectAll("*").remove();
      behaviour.current = null;
    };
  }, [options.enabled, x0, y0, x1, y1]);
  return {
    /** Clear the drawn brush without reporting it. */
    clear() {
      const b = behaviour.current;
      if (b && g.current) select(g.current).call(b.move, null);
    },
  };
}

/** The pointer's position in the SVG's viewBox units. */
export function svgPoint(e: Event, svg: SVGSVGElement): [number, number] {
  return pointer(e, svg);
}
