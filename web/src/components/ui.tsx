/* The small pieces every screen is built from.

   Deliberately few. DESIGN.md asks for strong typography, strong spacing and
   few actions, which is easier to hold to when there are only six things to
   reach for. */

import type { ReactNode } from "react";
import { explorer, shortKey } from "../lib/format";

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="section-title">{children}</div>;
}

export function Figure({
  value, label, lead = false,
}: { value: ReactNode; label: ReactNode; lead?: boolean }) {
  return (
    <div className={lead ? "figure lead" : "figure"}>
      <div className="value tabular">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

export function Rows({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="rows">
      {items.map(([term, value], i) => (
        <div key={i}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Panel({
  children, quiet = false,
}: { children: ReactNode; quiet?: boolean }) {
  return <div className={quiet ? "panel quiet" : "panel"}>{children}</div>;
}

/* Status is a word. No colour carries meaning anywhere in this interface, so
   this renders the same in greyscale as in full colour, and to a screen
   reader as to an eye. */
export function Status({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return <span className={strong ? "status strong" : "status"}>{children}</span>;
}

export function Key({ value, kind = "address" }: { value: string; kind?: "address" | "tx" }) {
  return (
    <a className="mono" href={explorer(value, kind)} target="_blank" rel="noreferrer">
      {shortKey(value)}
    </a>
  );
}

export function Disclosure({ children }: { children: ReactNode }) {
  return <div className="disclosure">{children}</div>;
}
