/**
 * Pure layout helpers for the SVG visuals: no DOM, so each is unit-tested. The visual
 * quality bar (dashboard-content.md section 11) is "no label overlap, zero lines,
 * legible at portal size"; label placement and wrapping are where overlap is decided.
 */

/** Wraps a label on spaces into lines of at most `max` characters (a long word is cut). */
export function wrapLabel(label: string, max: number, maxLines = 3): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    while (word.length > max) {
      if (line) (lines.push(line), (line = ""));
      lines.push(word.slice(0, max - 1) + "-");
      word = word.slice(max - 1);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= max) line += ` ${word}`;
    else (lines.push(line), (line = word));
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.slice(0, Math.max(1, max - 1))}…`;
    return kept;
  }
  return lines.length ? lines : [""];
}

/** A rough text width in px for the chart font size (12px sans). */
export const textWidth = (label: string, size = 12): number => Math.ceil(label.length * size * 0.56);

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Box, b: Box, gap = 2): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

export interface LabelItem {
  id: string;
  /** The mark's centre and radius. */
  x: number;
  y: number;
  r: number;
  text: string;
  /** Higher priority labels are placed first and win a contested spot. */
  priority?: number;
}

export interface Placed {
  id: string;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
  box: Box;
  /** False when no free spot exists: the label is left to the table and the tooltip. */
  shown: boolean;
}

/**
 * Greedy label placement: each label tries right, left, above, below, then the diagonals,
 * and takes the first spot clear of every mark and every label already placed and inside
 * the frame. A label that fits nowhere is not drawn (the data table and the mark's own
 * accessible name still carry it), so no two labels ever overlap.
 */
export function placeLabels(items: LabelItem[], frame: { w: number; h: number }, size = 12): Placed[] {
  const marks: Box[] = items.map((i) => ({ x: i.x - i.r, y: i.y - i.r, w: i.r * 2, h: i.r * 2 }));
  const taken: Box[] = [];
  const order = [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const out = new Map<string, Placed>();
  for (const item of order) {
    const w = textWidth(item.text, size);
    const h = size + 2;
    const pad = 4;
    const options: Array<[Placed["anchor"], number, number]> = [
      ["start", item.x + item.r + pad, item.y],
      ["end", item.x - item.r - pad, item.y],
      ["middle", item.x, item.y - item.r - pad - h / 2],
      ["middle", item.x, item.y + item.r + pad + h / 2],
      ["start", item.x + item.r * 0.7 + pad, item.y - item.r - h / 2],
      ["end", item.x - item.r * 0.7 - pad, item.y + item.r + h / 2],
    ];
    let chosen: Placed | null = null;
    for (const [anchor, x, y] of options) {
      const left = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
      const box: Box = { x: left, y: y - h / 2, w, h };
      const inside = box.x >= 0 && box.y >= 0 && box.x + box.w <= frame.w && box.y + box.h <= frame.h;
      if (inside && !marks.some((m) => overlaps(box, m, 1)) && !taken.some((t) => overlaps(box, t))) {
        chosen = { id: item.id, text: item.text, x, y, anchor, box, shown: true };
        break;
      }
    }
    if (chosen) taken.push(chosen.box);
    out.set(item.id, chosen ?? { id: item.id, text: item.text, x: item.x, y: item.y, anchor: "start", box: { x: 0, y: 0, w: 0, h: 0 }, shown: false });
  }
  return items.map((i) => out.get(i.id)!);
}

/**
 * Seat positions for a hemicycle of `seats` seats, as [x, y] around (0, 0), ordered left to
 * right by angle so consecutive seats belong to one faction. Rows get seats in proportion to
 * their radius, which keeps the spacing even.
 */
export function hemicycleSeats(seats: number, rows?: number): Array<[number, number]> {
  if (seats <= 0) return [];
  const count = rows ?? Math.max(1, Math.min(8, Math.round(Math.sqrt(seats / 3))));
  const inner = 0.45;
  const radii = Array.from({ length: count }, (_, i) => (count === 1 ? 1 : inner + ((1 - inner) * i) / (count - 1)));
  const total = radii.reduce((a, b) => a + b, 0);
  const per = radii.map((r) => Math.floor((seats * r) / total));
  let left = seats - per.reduce((a, b) => a + b, 0);
  for (let i = count - 1; left > 0; i = (i - 1 + count) % count, left--) per[i]!++;
  const all: Array<{ angle: number; point: [number, number] }> = [];
  radii.forEach((r, i) => {
    const n = per[i]!;
    for (let k = 0; k < n; k++) {
      const angle = n === 1 ? Math.PI / 2 : Math.PI - (Math.PI * k) / (n - 1);
      all.push({ angle, point: [r * Math.cos(angle), -r * Math.sin(angle)] });
    }
  });
  return all.sort((a, b) => b.angle - a.angle || a.point[1] - b.point[1]).map((s) => s.point);
}
