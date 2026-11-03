/** Fictional fixtures for the kit's own browser tests. The sentinel must never reach a build. */

import type { Fixtures } from "../src/testkit/index.ts";

export const SENTINEL = "FIXTURE-SENTINEL-7f3a";

const documents = Array.from({ length: 12 }, (_, i) => ({
  record_id: `doc_${String(i + 1).padStart(2, "0")}`,
  title: `${SENTINEL} sample document ${i + 1}`,
  outlet: i % 2 ? "Example Daily" : "Sample Weekly",
}));

export const FIXTURES: Fixtures = {
  nav: { engagements: [{ engagement: "eng_demo", period_id: "2026-10", release_kind: "cumulative", built_at: "2026-10-31T00:00:00Z" }] },
  brand: {
    display_name: "Demo Tenant",
    colors: { primary: "#5a2d82", accent: "#0b6e4f", ink: "#111111", surface: "#ffffff", muted: "#555555" },
    fonts: { font_heading: "Georgia, serif", font_body: "system-ui" },
    footer: "Powered by Stromy",
  },
  profiles: { "eng_demo/2026-10": { release_id: "rel_demo", briefs: [] } },
  recipes: {
    sov_by_theme: () => ({
      key: "sov_by_theme",
      release_id: "rel_demo",
      columns: [
        { name: "theme", type: "VARCHAR" },
        { name: "share", type: "DOUBLE" },
      ],
      rows: [
        { theme: "Grid capacity", share: 42 },
        { theme: "Prices", share: 31 },
        { theme: "Permits", share: 27 },
      ],
      caveats: [{ caveat_id: "cav_demo", text: "Sample data for the kit's tests." }],
      params: { brief_id: "brf_sov" },
    }),
    browse_records: (params) => {
      const page = Number(params.get("page") ?? "1");
      const size = Number(params.get("page_size") ?? "5");
      const rows = documents.slice((page - 1) * size, page * size).map((d) => ({ ...d, total: documents.length }));
      return {
        key: "browse_records",
        release_id: "rel_demo",
        columns: [
          { name: "record_id", type: "VARCHAR" },
          { name: "title", type: "VARCHAR" },
          { name: "outlet", type: "VARCHAR" },
          { name: "total", type: "INTEGER" },
        ],
        rows,
        caveats: [],
        params: { kind: "document", page, page_size: size },
      };
    },
  },
};
