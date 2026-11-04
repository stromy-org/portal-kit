/** @jsxImportSource preact */
/**
 * Every panel renders through PanelFrame, and PanelFrame shows numbers only in
 * `ready` (portal-shell.md decision 9). An empty, insufficient, unavailable, denied
 * or failed panel says so in words; it never shows a 0 that means "unknown".
 */

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { GatekeeperError } from "../client/index.ts";
import { type Caveat, ContractError, type RecipeResult } from "../contract/index.ts";

export type PanelState<T> =
  | { k: "loading" }
  | { k: "slow" }
  | { k: "ready"; data: T; caveats: Caveat[] }
  | { k: "empty"; caveats: Caveat[] }
  | { k: "insufficient"; have: number; need: number; caveats: Caveat[] }
  | { k: "unavailable" }
  | { k: "denied" }
  | { k: "error"; cls: "network" | "timeout" | "server" | "contract" | "auth" };

export type Judgement = "ready" | "empty" | { have: number; need: number };

/** Default reading of a recipe: no rows is empty, anything else is ready. */
export const byRows = (result: RecipeResult): Judgement =>
  result.rows.length === 0 ? "empty" : "ready";

export function stateOf<T extends { caveats?: Caveat[] }>(
  data: T,
  judge: (data: T) => Judgement,
): PanelState<T> {
  const caveats = data.caveats ?? [];
  const verdict = judge(data);
  if (verdict === "ready") return { k: "ready", data, caveats };
  if (verdict === "empty") return { k: "empty", caveats };
  return { k: "insufficient", have: verdict.have, need: verdict.need, caveats };
}

export function stateFromError(error: unknown): PanelState<never> {
  if (error instanceof GatekeeperError) {
    switch (error.kind) {
      case "denied":
        return { k: "denied" };
      case "unavailable":
        return { k: "unavailable" };
      case "timeout":
        return { k: "error", cls: "timeout" };
      case "network":
        return { k: "error", cls: "network" };
      case "auth":
        return { k: "error", cls: "auth" };
      case "contract":
      case "invalid":
        return { k: "error", cls: "contract" };
    }
  }
  if (error instanceof ContractError) return { k: "error", cls: "contract" };
  return { k: "error", cls: "server" };
}

/** Loads one panel; switches to `slow` after `slowMs`; cancels on change or unmount. */
export function usePanel<T extends { caveats?: Caveat[] }>(
  load: (signal: AbortSignal) => Promise<T>,
  judge: (data: T) => Judgement,
  deps: unknown[],
  slowMs = 3000,
): [PanelState<T>, () => void] {
  const [state, setState] = useState<PanelState<T>>({ k: "loading" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    const id = ++latest.current;
    const controller = new AbortController();
    setState({ k: "loading" });
    const timer = setTimeout(() => {
      if (latest.current === id) setState((s) => (s.k === "loading" ? { k: "slow" } : s));
    }, slowMs);
    load(controller.signal)
      .then((data) => {
        if (latest.current === id) setState(stateOf(data, judge));
      })
      .catch((error: unknown) => {
        if (latest.current === id && !controller.signal.aborted) setState(stateFromError(error));
      })
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return [state, () => setAttempt((a) => a + 1)];
}

export interface Wording {
  loading: string;
  slow: string;
  empty: string;
  insufficient: (have: number, need: number) => string;
  unavailable: string;
  denied: string;
  error: Record<"network" | "timeout" | "server" | "contract" | "auth", string>;
  retry: string;
  notes: string;
}

export const DEFAULT_WORDING: Wording = {
  loading: "Loading…",
  slow: "Waking the service. The first view after a quiet spell can take up to half a minute.",
  empty: "Nothing recorded for this selection.",
  insufficient: (have, need) =>
    `Too few records to summarise: ${have} found, at least ${need} needed.`,
  unavailable: "Nothing has been published for this period yet.",
  denied: "You do not have access to this view.",
  error: {
    network: "The service could not be reached.",
    timeout: "The service took too long to answer.",
    server: "Something went wrong while loading this view.",
    contract: "This view could not be read. Reload the page; if it persists, tell your Stromy contact.",
    auth: "Your sign-in has expired. Sign in again to continue.",
  },
  retry: "Try again",
  notes: "Notes",
};

export interface PanelFrameProps<T> {
  title: string;
  state: PanelState<T>;
  retry?: () => void;
  wording?: Wording;
  children: (data: T) => ComponentChildren;
  /** Shown under an insufficient summary when the records themselves may be listed. */
  belowInsufficient?: ComponentChildren;
}

export function PanelFrame<T>(props: PanelFrameProps<T>) {
  const w = props.wording ?? DEFAULT_WORDING;
  const s = props.state;
  return (
    <section class="pk-panel" data-state={s.k} aria-busy={s.k === "loading" || s.k === "slow"}>
      <h2 class="pk-panel__title">{props.title}</h2>
      {body(s, w, props)}
      {"caveats" in s && s.caveats.length > 0 && (
        // Not a landmark: a page shows many panels, and repeated complementary
        // landmarks with one name fail WCAG landmark-unique (found by axe on a portal).
        <div class="pk-panel__notes">
          <h3>{w.notes}</h3>
          <ul>
            {s.caveats.map((c) => (
              <li key={c.caveat_id}>{c.text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function body<T>(s: PanelState<T>, w: Wording, props: PanelFrameProps<T>) {
  switch (s.k) {
    case "loading":
      return (
        <p class="pk-panel__status" role="status">
          {w.loading}
        </p>
      );
    case "slow":
      return (
        <p class="pk-panel__status" role="status">
          {w.slow}
        </p>
      );
    case "ready":
      return <div class="pk-panel__body">{props.children(s.data)}</div>;
    case "empty":
      return (
        <p class="pk-panel__status" role="status">
          {w.empty}
        </p>
      );
    case "insufficient":
      return (
        <div class="pk-panel__body">
          <p class="pk-panel__status" role="status">
            {w.insufficient(s.have, s.need)}
          </p>
          {props.belowInsufficient}
        </div>
      );
    case "unavailable":
      return (
        <p class="pk-panel__status" role="status">
          {w.unavailable}
        </p>
      );
    case "denied":
      return (
        <p class="pk-panel__status" role="status">
          {w.denied}
        </p>
      );
    case "error":
      return (
        <div class="pk-panel__status" role="status">
          <p>{w.error[s.cls]}</p>
          {props.retry && s.cls !== "auth" && (
            <button type="button" class="pk-button" onClick={props.retry}>
              {w.retry}
            </button>
          )}
        </div>
      );
    default: {
      const never: never = s;
      return never;
    }
  }
}
