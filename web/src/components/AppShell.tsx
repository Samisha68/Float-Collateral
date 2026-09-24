/* The frame everything sits in.

   A fixed sidebar, a header that carries the wallet, and a content column.
   This is app chrome rather than page layout, which is the difference between
   reading about a product and being inside one.

   Iconography is monochrome throughout. DESIGN.md forbids status carried in
   colour, and an icon that means something only if you can see its hue breaks
   the same rule a red badge would. */

import type { ReactNode } from "react";
import { Building2, Scale, BookOpen, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectButton, WalletChip } from "@/wallet";
import { config } from "@/lib/chain";
import { explorer } from "@/lib/format";

export type Tab = "account" | "compare" | "about";

const NAV: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "account", label: "Your account", icon: Building2 },
  { id: "compare", label: "Why terms differ", icon: Scale },
  { id: "about", label: "How this works", icon: BookOpen },
];

export function AppShell({
  tab, setTab, title, children,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b px-5">
          <img src="/float-favicon.svg" alt="" className="h-7 w-auto" />
          <span className="text-body font-semibold tracking-tight">Float</span>
        </div>

        <nav aria-label="Sections" className="flex-1 space-y-0.5 p-3">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={cn(
                "flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-meta transition-colors",
                tab === id
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </nav>

        <div className="space-y-3 border-t p-4">
          <div className="space-y-1.5 text-micro leading-relaxed text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Devnet.</span> No real money moves.
              USDC is a test mint Float controls and verification is done by Float's own key.
            </p>
            <a
              href={explorer(config.programId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-micro hover:text-foreground"
            >
              {config.programId.slice(0, 4)}…{config.programId.slice(-4)}
              <ExternalLink className="size-3" strokeWidth={1.75} />
            </a>
          </div>
        </div>
      </aside>

      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-20 flex h-16 items-center justify-between gap-4 border-b bg-background/85 px-4 backdrop-blur lg:left-60 lg:px-8">
        <div className="flex items-center gap-2.5 lg:hidden">
          <img src="/float-favicon.svg" alt="" className="h-6 w-auto" />
          <span className="text-sm font-semibold">Float</span>
        </div>
        <h1 className="text-body font-medium tracking-tight max-lg:sr-only">{title}</h1>
        <div className="flex items-center gap-3">
          <WalletChip />
          <ConnectButton />
        </div>
      </header>

      {/* Mobile nav */}
      <nav aria-label="Sections" className="fixed inset-x-0 top-16 z-20 flex gap-1 overflow-x-auto border-b bg-background px-4 py-2 lg:hidden">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-meta transition-colors",
              tab === id ? "bg-accent font-medium" : "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </nav>

      <main className="px-4 pt-32 pb-24 lg:pl-68 lg:pr-8 lg:pt-24">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
    </div>
  );
}

/* A section heading with room above it. Used between cards so a long page
   still has a spine. */
export function SectionHeading({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 mt-10 flex items-baseline justify-between gap-4 first:mt-0">
      <h2 className="text-meta font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {children}
      </h2>
      {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
    </div>
  );
}
