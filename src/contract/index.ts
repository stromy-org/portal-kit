/**
 * The gatekeeper data contract, validated at runtime.
 *
 * Every response is checked before any component sees it: a static type is not
 * safety when the server is another repository. The validators are hand-written on
 * purpose. Schema libraries that probe `new Function` at load time raise violations
 * under a strict Content-Security-Policy, and this shell ships one.
 */

export const CONTRACT_MAJOR = 1;

export type Scalar = string | number | boolean | null;
export type Row = Record<string, unknown>;

export interface NavEntry {
  engagement: string;
  /** The published release's period; null when the engagement has nothing published yet. */
  period_id: string | null;
  release_kind?: string | null;
  built_at?: string;
}

export interface Nav {
  engagements: NavEntry[];
}

export interface Brand {
  display_name: string | null;
  colors: Record<string, string>;
  fonts: Record<string, string>;
  footer: string;
}

export interface Column {
  name: string;
  type: string;
}

export interface Caveat {
  caveat_id: string;
  text: string;
  [key: string]: unknown;
}

/** One recipe's result: the dashboard's only data shape. */
export interface RecipeResult {
  key: string;
  release_id: string;
  columns: Column[];
  rows: Row[];
  caveats: Caveat[];
  params: Record<string, unknown>;
  [key: string]: unknown;
}

/** The engagement card (`profile`): free-form beyond these fields. */
export interface Profile {
  release_id: string;
  briefs: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export class ContractError extends Error {
  constructor(readonly where: string) {
    super(`contract violation at ${where}`);
    this.name = "ContractError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

function need(ok: boolean, where: string): asserts ok {
  if (!ok) throw new ContractError(where);
}

function stringMap(v: unknown, where: string): Record<string, string> {
  need(isObject(v), where);
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(v)) {
    need(isString(value), `${where}.${k}`);
    out[k] = value;
  }
  return out;
}

export function parseNav(v: unknown): Nav {
  need(isObject(v) && Array.isArray(v.engagements), "nav");
  const engagements = v.engagements.map((e, i): NavEntry => {
    const where = `nav.engagements[${i}]`;
    need(isObject(e) && isString(e.engagement), where);
    need(e.period_id === null || isString(e.period_id), `${where}.period_id`);
    const entry: NavEntry = { engagement: e.engagement, period_id: e.period_id as string | null };
    if (e.release_kind === null || isString(e.release_kind)) entry.release_kind = e.release_kind;
    if (isString(e.built_at)) entry.built_at = e.built_at;
    return entry;
  });
  return { engagements };
}

export function parseBrand(v: unknown): Brand {
  need(isObject(v), "brand");
  need(v.display_name === null || isString(v.display_name), "brand.display_name");
  need(isString(v.footer), "brand.footer");
  return {
    display_name: v.display_name as string | null,
    colors: stringMap(v.colors, "brand.colors"),
    fonts: stringMap(v.fonts, "brand.fonts"),
    footer: v.footer,
  };
}

export function parseRecipe(v: unknown, expectedKey?: string): RecipeResult {
  need(isObject(v), "recipe");
  need(isString(v.key) && (expectedKey === undefined || v.key === expectedKey), "recipe.key");
  need(isString(v.release_id), "recipe.release_id");
  need(Array.isArray(v.columns), "recipe.columns");
  const columns = v.columns.map((c, i): Column => {
    need(isObject(c) && isString(c.name) && isString(c.type), `recipe.columns[${i}]`);
    return { name: c.name, type: c.type };
  });
  need(Array.isArray(v.rows) && v.rows.every(isObject), "recipe.rows");
  need(Array.isArray(v.caveats), "recipe.caveats");
  const caveats = v.caveats.map((c, i): Caveat => {
    need(isObject(c) && isString(c.caveat_id) && isString(c.text), `recipe.caveats[${i}]`);
    return c as Caveat;
  });
  need(isObject(v.params), "recipe.params");
  return { ...v, key: v.key, release_id: v.release_id, columns, rows: v.rows, caveats, params: v.params };
}

export function parseProfile(v: unknown): Profile {
  need(isObject(v) && isString(v.release_id), "profile.release_id");
  need(Array.isArray(v.briefs) && v.briefs.every(isObject), "profile.briefs");
  return v as Profile;
}
