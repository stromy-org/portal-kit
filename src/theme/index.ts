/**
 * Runtime tenant theme (portal-shell.md decision 10).
 *
 * The gatekeeper sends a token map; the shell validates every value again, guards
 * contrast, and applies tokens with `style.setProperty` on the root element. That is
 * a CSSOM write, which a strict style-src does not block; `setAttribute('style')`
 * and `cssText` go through the attribute path and would be blocked, so they are never
 * used. A failed or missing brand leaves the neutral tokens in place.
 */

import type { Brand } from "../contract/index.ts";

export const COLOR_TOKENS = ["primary", "accent", "ink", "surface", "muted"] as const;
export const FONT_TOKENS = ["font_heading", "font_body"] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[A-Za-z0-9 ,'-]{1,80}$/;

export interface Theme {
  colors: Partial<Record<(typeof COLOR_TOKENS)[number], string>>;
  fonts: Partial<Record<(typeof FONT_TOKENS)[number], string>>;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Keeps only well-formed tokens, then drops any colour that would fail contrast
 * against the surface it sits on: text (ink, muted) needs 4.5:1, UI colours 3:1.
 */
export function safeTheme(brand: Brand | null, neutral: Theme): Theme {
  const colors: Theme["colors"] = { ...neutral.colors };
  const fonts: Theme["fonts"] = { ...neutral.fonts };
  if (brand) {
    for (const key of COLOR_TOKENS) {
      const value = brand.colors[key];
      if (value !== undefined && HEX.test(value)) colors[key] = value;
    }
    for (const key of FONT_TOKENS) {
      const value = brand.fonts[key];
      if (value !== undefined && FONT.test(value)) fonts[key] = value;
    }
  }
  const surface = colors.surface ?? "#ffffff";
  const floor: Record<string, number> = { ink: 4.5, muted: 4.5, primary: 3, accent: 3 };
  for (const [key, min] of Object.entries(floor)) {
    const k = key as (typeof COLOR_TOKENS)[number];
    const value = colors[k];
    if (value !== undefined && contrast(value, surface) < min) colors[k] = neutral.colors[k];
  }
  if (colors.surface !== neutral.colors.surface && colors.ink && contrast(colors.ink, surface) < 4.5) {
    colors.surface = neutral.colors.surface;
  }
  return { colors, fonts };
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const key of COLOR_TOKENS) {
    const value = theme.colors[key];
    if (value !== undefined) root.style.setProperty(`--pk-${key}`, value);
  }
  for (const key of FONT_TOKENS) {
    const value = theme.fonts[key];
    if (value !== undefined) root.style.setProperty(`--pk-${key.replace("_", "-")}`, value);
  }
}
