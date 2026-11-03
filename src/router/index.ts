/**
 * The URL is the state: /app/<engagement>/<period>/<view>?<params>.
 *
 * One codec owns the mapping and drops anything malformed rather than trusting it.
 * The router owns the page-change contract (dashboard-content.md §14.6):
 * - a forward navigation resets scroll to the top and moves focus to the view's h1;
 * - back/forward restores the saved scroll only after the view has rendered
 *   (call `settled()` once data is on screen), never onto a skeleton;
 * - every change updates document.title and is announced once.
 */

export interface Route {
  engagement?: string;
  period?: string;
  view?: string;
  params: Record<string, string>;
}

export type Navigation = "push" | "replace" | "pop" | "start";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const VIEW = /^[a-z][a-z0-9-]{0,63}$/;
const PARAM = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_VALUE = 200;
const MAX_PARAMS = 12;

export function parseRoute(pathname: string, search: string, base = "/app"): Route {
  const route: Route = { params: {} };
  if (!pathname.startsWith(base)) return route;
  const parts = pathname.slice(base.length).split("/").filter(Boolean).map(safeDecode);
  const [engagement, period, view] = parts;
  if (parts.length > 3) return route;
  if (engagement !== undefined && ID.test(engagement)) route.engagement = engagement;
  else return route;
  if (period !== undefined && ID.test(period)) route.period = period;
  else return route;
  if (view !== undefined && VIEW.test(view)) route.view = view;
  const query = new URLSearchParams(search);
  for (const [key, value] of query) {
    if (Object.keys(route.params).length >= MAX_PARAMS) break;
    if (PARAM.test(key) && value.length <= MAX_VALUE && !(key in route.params)) {
      route.params[key] = value;
    }
  }
  return route;
}

export function formatRoute(route: Route, base = "/app"): string {
  const parts: string[] = [];
  if (route.engagement && ID.test(route.engagement)) {
    parts.push(encodeURIComponent(route.engagement));
    if (route.period && ID.test(route.period)) {
      parts.push(encodeURIComponent(route.period));
      if (route.view && VIEW.test(route.view)) parts.push(route.view);
    }
  }
  const query = new URLSearchParams();
  for (const key of Object.keys(route.params).sort()) {
    const value = route.params[key];
    if (value !== undefined && value !== "" && PARAM.test(key) && value.length <= MAX_VALUE) {
      query.set(key, value);
    }
  }
  const search = query.toString();
  return `${base}/${parts.join("/")}${parts.length ? "/" : ""}${search ? `?${search}` : ""}`;
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return "";
  }
}

interface Saved {
  portalY?: number;
}

export interface RouterOptions {
  base?: string;
  onChange: (route: Route, how: Navigation) => void;
  window?: Window;
  announce?: (message: string) => void;
}

export class Router {
  private readonly win: Window;
  private readonly base: string;
  private pending: { how: Navigation; y: number | undefined } | null = null;

  constructor(private readonly options: RouterOptions) {
    this.win = options.window ?? globalThis.window;
    this.base = options.base ?? "/app";
  }

  start(): Route {
    this.win.history.scrollRestoration = "manual";
    this.win.addEventListener("popstate", this.onPop);
    const route = this.current();
    this.pending = { how: "start", y: undefined };
    this.options.onChange(route, "start");
    return route;
  }

  stop(): void {
    this.win.removeEventListener("popstate", this.onPop);
  }

  current(): Route {
    return parseRoute(this.win.location.pathname, this.win.location.search, this.base);
  }

  href(route: Route): string {
    return formatRoute(route, this.base);
  }

  navigate(route: Route, { replace = false }: { replace?: boolean } = {}): void {
    const url = this.href(route);
    this.saveScroll();
    if (replace) this.win.history.replaceState({}, "", url);
    else this.win.history.pushState({}, "", url);
    const how: Navigation = replace ? "replace" : "push";
    this.pending = { how, y: undefined };
    this.options.onChange(this.current(), how);
  }

  /**
   * Call once the new view's content is rendered. Applies the scroll and focus
   * contract and the title. Calling it twice for one navigation does nothing.
   */
  settled(title: string): void {
    const pending = this.pending;
    if (pending === null) return;
    this.pending = null;
    this.win.document.title = title;
    if (pending.how === "pop") {
      this.win.scrollTo(0, pending.y ?? 0);
    } else if (pending.how === "push" || pending.how === "start") {
      this.win.scrollTo(0, 0);
      const heading = this.win.document.querySelector<HTMLElement>("main h1");
      if (heading) {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }
    this.options.announce?.(title);
  }

  private saveScroll(): void {
    const state = { ...(this.win.history.state as Saved | null), portalY: this.win.scrollY };
    this.win.history.replaceState(state, "");
  }

  private onPop = (event: PopStateEvent): void => {
    const saved = event.state as Saved | null;
    this.pending = { how: "pop", y: saved?.portalY };
    this.options.onChange(this.current(), "pop");
  };
}
