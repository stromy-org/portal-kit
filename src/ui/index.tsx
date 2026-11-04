/** @jsxImportSource preact */
/**
 * Accessible primitives (WCAG 2.2 AA): a real table, labelled pagination, a native
 * dialog drawer and one polite announcer. Styling is by class only; nothing here
 * writes a `style` attribute (the shell's CSP forbids inline styles).
 */

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

import type { Column, Row } from "../contract/index.ts";

export type Cell = (row: Row, column: Column) => ComponentChildren;

export function plain(row: Row, column: Column): ComponentChildren {
  const value = row[column.name];
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface DataTableProps {
  caption: string;
  columns: Column[];
  rows: Row[];
  /** Header text per column name; defaults to the column name. */
  labels?: Record<string, string>;
  cell?: Cell;
  rowKey?: (row: Row, index: number) => string;
  /** Focus target after a page change. */
  captionRef?: { current: HTMLTableCaptionElement | null };
}

export function DataTable(props: DataTableProps) {
  const cell = props.cell ?? plain;
  return (
    <div class="pk-table" role="region" aria-label={props.caption} tabIndex={0}>
      <table>
        <caption ref={props.captionRef} tabIndex={-1}>
          {props.caption}
        </caption>
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th key={c.name} scope="col">
                {props.labels?.[c.name] ?? c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr key={props.rowKey ? props.rowKey(row, i) : String(i)}>
              {props.columns.map((c) => (
                <td key={c.name}>{cell(row, c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  label?: string;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

export function Pagination(props: PaginationProps) {
  const pages = pageCount(props.total, props.pageSize);
  const go = (page: number) => () => props.onPage(Math.min(pages, Math.max(1, page)));
  return (
    <nav class="pk-pagination" aria-label={props.label ?? "Pagination"}>
      <button type="button" class="pk-button" disabled={props.page <= 1} onClick={go(props.page - 1)}>
        Previous
      </button>
      <span aria-current="page">
        Page {props.page} of {pages}
      </span>
      <button type="button" class="pk-button" disabled={props.page >= pages} onClick={go(props.page + 1)}>
        Next
      </button>
    </nav>
  );
}

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}

/** A modal drawer on the native <dialog>: focus trap, Esc and inert background built in. */
export function Drawer(props: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal?.();
    } else if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);
  const closed = () => {
    if (opener.current instanceof HTMLElement) opener.current.focus();
    props.onClose();
  };
  return (
    <dialog ref={ref} class="pk-drawer" aria-label={props.title} onClose={closed}>
      <header class="pk-drawer__head">
        <h2>{props.title}</h2>
        <button type="button" class="pk-button" onClick={() => ref.current?.close()}>
          Close
        </button>
      </header>
      <div class="pk-drawer__body">{props.children}</div>
    </dialog>
  );
}

/** One polite live region per page; route changes and page changes announce here. */
export function createAnnouncer(doc: Document = document): (message: string) => void {
  let region = doc.getElementById("pk-announcer");
  if (!region) {
    region = doc.createElement("div");
    region.id = "pk-announcer";
    region.className = "pk-visually-hidden";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("role", "status");
    doc.body.appendChild(region);
  }
  const target = region;
  return (message: string) => {
    target.textContent = "";
    // A fresh text node after clearing makes screen readers repeat identical messages.
    globalThis.setTimeout(() => {
      target.textContent = message;
    }, 50);
  };
}
