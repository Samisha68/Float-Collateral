/* Four pieces. The earlier set had a Panel that everything ended up inside,
   which is how the interface turned into a stack of boxes. There is no box
   here on purpose: a section is a heading, a hairline, and some air. */

import type { ReactNode } from "react";
import { explorer, shortKey } from "../lib/format";

export function Block({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="block">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** A column of figures against their labels. Hairlines, no border. */
export function Ledger({
  rows, head,
}: {
  rows: [ReactNode, ReactNode][];
  head?: [ReactNode, ...ReactNode[]];
}) {
  return (
    <table className="ledger">
      {head && (
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={i === 0 ? undefined : "num"}>{h}</th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A few figures side by side, for the numbers that carry a screen. */
export function Spread({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <div className="spread">
      {items.map(([value, label], i) => (
        <div key={i}>
          <div className="v">{value}</div>
          <div className="k">{label}</div>
        </div>
      ))}
    </div>
  );
}

/** Status is a word. No colour carries meaning anywhere in this interface. */
export function Status({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return <span className={quiet ? "status quiet" : "status"}>{children}</span>;
}

export function Key({ value, kind = "address" }: { value: string; kind?: "address" | "tx" }) {
  return (
    <a className="mono" href={explorer(value, kind)} target="_blank" rel="noreferrer">
      {shortKey(value)}
    </a>
  );
}
