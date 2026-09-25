/* The frame for someone who has not signed in.

   A top bar and a column, which is what a website looks like. The app's
   sidebar is deliberately absent: its links read "Your account" and "Your
   profile", and a visitor has neither. Showing them anyway is how a product
   ends up looking like an internal tool that happens to have a URL. */

import type { ReactNode } from "react";
import { Scale, BookOpen, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectButton } from "@/wallet";
import { config } from "@/lib/chain";
import { explorer } from "@/lib/format";
import type { Tab } from "./AppShell";

const LINKS: { id: Tab; label: string; icon: typeof Scale }[] = [
  { id: "compare", label: "Why terms differ", icon: Scale },
  { id: "about", label: "How this works", icon: BookOpen },
];

export function SiteShell({
  tab, setTab, children,
}: { tab: Tab; setTab: (t: Tab) => void; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <button
            onClick={() => setTab("account")}
            className="flex items-center gap-2.5"
            aria-label="Float home"
          >
            <img src="/float-favicon.svg" alt="" className="h-7 w-auto" />
            <span className="text-body font-semibold tracking-tight">Float</span>
          </button>

          <nav aria-label="About Float" className="flex items-center gap-1">
            {LINKS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={tab === id ? "page" : undefined}
                className={cn(
                  "hidden min-h-11 items-center rounded-md px-2.5 text-meta transition-colors sm:inline-flex",
                  tab === id
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
            <div className="ml-1.5">
              <ConnectButton />
            </div>
          </nav>
        </div>

        {/* On a phone the two links move under the bar rather than crowding it. */}
        <nav
          aria-label="About Float"
          className="flex gap-1 border-t px-4 py-1.5 sm:hidden"
        >
          {LINKS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-caption transition-colors",
                tab === id ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        {/* The devnet caveat is stated once, on the page, where it is read.
            Repeating it here made the footer a second copy of the section
            above it. */}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-6">
          <p className="text-caption text-muted-foreground">Float · Solana devnet</p>
          <a
            href={explorer(config.programId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-caption text-muted-foreground hover:text-foreground"
          >
            {config.programId.slice(0, 4)}…{config.programId.slice(-4)}
            <ExternalLink className="size-3" strokeWidth={1.75} />
          </a>
        </div>
      </footer>
    </div>
  );
}
