/* Float's own pieces, built on shadcn's.

   Kept small: a figure, a row of figures, a definition list, a status word and
   an address link. Everything else is a Card. */

import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { explorer, shortKey } from "@/lib/format";

/** The one number a screen is built around. */
export function Headline({
  value, label, sub,
}: { value: ReactNode; label: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="tabular text-[40px] font-semibold leading-none tracking-[-0.035em]">
        {value}
      </div>
      <div className="mt-2 text-[13.5px] text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-[12.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Supporting figures, side by side. */
export function Stats({ items }: { items: { value: ReactNode; label: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
      {items.map((it, i) => (
        <div key={i}>
          <div className="tabular text-[20px] font-semibold tracking-tight">{it.value}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Label on the left, figure on the right, one hairline between. */
export function Rows({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y">
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-6 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-[13.5px] text-muted-foreground">{k}</dt>
          <dd className="tabular text-right text-[13.5px] font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Status is a word. The badge is an outline, never a colour. */
export function StatusWord({
  children, solid = false,
}: { children: ReactNode; solid?: boolean }) {
  return (
    <Badge
      variant={solid ? "default" : "outline"}
      className={cn("rounded-full px-2 py-0 text-[10.5px] font-medium uppercase tracking-[0.08em]")}
    >
      {children}
    </Badge>
  );
}

export function KeyLink({
  value, kind = "address", full = false,
}: { value: string; kind?: "address" | "tx"; full?: boolean }) {
  return (
    <a
      href={explorer(value, kind)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[12px] underline decoration-border underline-offset-[3px] transition-colors hover:decoration-foreground"
    >
      {full ? value : shortKey(value)}
      <ExternalLink className="size-3 shrink-0" strokeWidth={1.75} />
    </a>
  );
}
