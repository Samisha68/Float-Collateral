/* Wallet connection.

   Devnet, and deliberately unopinionated about which wallet: the adapter
   discovers anything speaking the Wallet Standard, which is every wallet a
   judge is likely to already have. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  Wallet as WalletIcon, LogOut, Copy, Check, ExternalLink, RefreshCw, ChevronDown, User, Mail,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { explorer } from "@/lib/format";
import { usePrivySession, usePrivyWalletNames } from "@/privy";
/* The adapter's own stylesheet is deliberately NOT imported. It is a dark
   theme carrying a purple accent and a Google Fonts download, and forcing it
   light left the modal title white on white. Float styles the modal itself,
   in index.css. */
import { RPC } from "@/lib/chain";
import { shortKey } from "@/lib/format";

export function Wallet({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => RPC, []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <PrivyAutoConnect />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/* Connect the wallet Privy just provisioned.

   Registering a wallet into the Wallet Standard registry only makes it
   selectable. Somebody still has to select it, and after a Privy sign-in
   nobody ever would: the user has already chosen, and asking them to pick the
   same wallet again out of a list of one is not a choice. The first version
   of the bridge stopped at registration, which is why signing in left people
   watching "Preparing your wallet" while a perfectly good wallet sat unused.

   This has to live inside WalletProvider, and the bridge that registers has
   to live outside it — the adapter reads the registry when it mounts, so
   Privy must register first. The wallet names travel down between them. */
function PrivyAutoConnect() {
  const names = usePrivyWalletNames();
  const { wallets, wallet, select, connect, connecting, publicKey } = useWallet();

  /* Every guard is a ref. A retry counter kept in state is itself a
     re-render, and re-rendering is exactly what drove the first version of
     this into 270 failed connections a second. */
  const attempted = useRef(new Set<string>());

  /* A string, not the array. `wallets` is a fresh reference on every render,
     so depending on it directly re-runs this forever. */
  const available = wallets.map((w) => String(w.adapter.name)).join("|");

  const target = useMemo(() => {
    if (names.length === 0) return null;
    return available.split("|").find((n) => n && names.includes(n)) ?? null;
  }, [names, available]);

  useEffect(() => {
    if (!target || publicKey || connecting) return;
    if (attempted.current.has(target)) return;

    if (String(wallet?.adapter.name) !== target) {
      select(target as any);
      return;
    }

    /* Selected but not connected, so autoConnect did not take. Exactly one
       attempt per wallet, ever. If it fails, ConnectButton's recovery state
       takes over instead of this trying again. */
    attempted.current.add(target);
    connect().catch(() => {});
  }, [target, publicKey, connecting, wallet, select, connect]);

  return null;
}

/** Copy to clipboard, with the confirmation the click needs.

    `navigator.clipboard` is unavailable over plain HTTP on anything but
    localhost, and a copy button that silently does nothing is worse than no
    copy button, so the fallback is a real one and failure is reported. */
export function useCopy(text: string) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement("textarea");
        el.value = text;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(el);
        if (!ok) throw new Error("copy refused");
      }
      setState("done");
    } catch {
      setState("failed");
    }
  }, [text]);

  return { copy, state };
}

/** The connected address, so it is visible without opening anything.
    Clicking it copies, because that is what people try first. */
export function WalletChip() {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? "";
  const { copy, state } = useCopy(address);
  if (!publicKey) return null;
  return (
    <button
      onClick={copy}
      title={address}
      aria-label={state === "done" ? "Address copied" : `Copy address ${address}`}
      className="hidden min-h-9 items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1 font-mono text-micro text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
    >
      {shortKey(address)}
      {state === "done" ? (
        <Check className="size-3" strokeWidth={2.25} />
      ) : (
        <Copy className="size-3" strokeWidth={1.75} />
      )}
    </button>
  );
}

/** The connected wallet, and everything you can do to it.

    Disconnect used to be the only option, which made the button a dead end:
    no way to read the full address, no way to copy it, no way to switch
    wallets without disconnecting first. All four now live behind one control,
    and the address is written out in full because a truncated one cannot be
    checked against a wallet's own display. */
function WalletMenu({ onProfile }: { onProfile?: () => void }) {
  const { publicKey, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const session = usePrivySession();
  const address = publicKey!.toBase58();
  const { copy, state } = useCopy(address);

  /* Signing out has to end both sessions. Disconnecting the adapter while
     Privy still holds the login leaves a user who pressed "disconnect" still
     logged in, and the wallet silently reappears on the next render. */
  const signOut = async () => {
    try { await disconnect(); } finally {
      if (session.enabled && session.authenticated) await session.logout();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-11">
          {wallet?.adapter.icon ? (
            <img src={wallet.adapter.icon} alt="" className="size-4 rounded-sm" />
          ) : (
            <WalletIcon className="size-4" strokeWidth={1.75} />
          )}
          <span className="max-sm:sr-only">{shortKey(address)}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[19rem]">
        <DropdownMenuLabel className="space-y-1.5 py-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            {wallet?.adapter.icon && (
              <img src={wallet.adapter.icon} alt="" className="size-4 rounded-sm" />
            )}
            <span className="text-micro uppercase tracking-[0.08em]">
              {wallet?.adapter.name ?? "Connected"} · devnet
            </span>
          </div>
          {session.authenticated && session.email && (
            <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Mail className="size-3" strokeWidth={1.75} />
              {session.email}
            </div>
          )}
          <div className="font-mono text-caption leading-relaxed break-all text-foreground">
            {address}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {onProfile && (
          <DropdownMenuItem onSelect={onProfile}>
            <User strokeWidth={1.75} />
            Your profile
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); copy(); }}>
          {state === "done" ? <Check strokeWidth={2.25} /> : <Copy strokeWidth={1.75} />}
          {state === "done" ? "Copied" : state === "failed" ? "Could not copy" : "Copy address"}
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <a href={explorer(address)} target="_blank" rel="noreferrer">
            <ExternalLink strokeWidth={1.75} />
            View on Solana Explorer
          </a>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {!session.enabled && (
          <DropdownMenuItem onSelect={() => setVisible(true)}>
            <RefreshCw strokeWidth={1.75} />
            Switch wallet
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onSelect={() => { void signOut(); }}>
          <LogOut strokeWidth={1.75} />
          {session.authenticated ? "Sign out" : "Disconnect"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConnectButton({
  size = "sm", onProfile, label,
}: { size?: "sm" | "lg"; onProfile?: () => void; label?: string }) {
  const { publicKey, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const session = usePrivySession();
  const big = size === "lg";

  if (publicKey) return <WalletMenu onProfile={onProfile} />;

  if (connecting)
    return (
      <Button size={big ? "lg" : "sm"} className="min-h-11" disabled>
        <WalletIcon className="size-4 animate-pulse" strokeWidth={1.75} />
        Connecting…
      </Button>
    );

  /* Signed in, but no wallet has reached the adapter yet. Usually a second or
     two while Privy provisions one. */
  if (session.enabled && session.authenticated)
    return <Provisioning big={big} />;

  /* One button. Where the visitor goes after pressing it — email, Google, or
     their own wallet — is Privy's question to ask, not the landing page's. */
  const open = session.enabled ? session.login : () => setVisible(true);

  return (
    <Button size={big ? "lg" : "sm"} className="min-h-11" onClick={open}>
      {session.enabled
        ? <Mail className="size-4" strokeWidth={1.75} />
        : <WalletIcon className="size-4" strokeWidth={1.75} />}
      {label ?? (big ? "Get started" : "Sign in")}
    </Button>
  );
}

/* Privy says the user is authenticated but no wallet has appeared in the
   adapter's registry. Normally that is a moment. If it lasts, something in
   the bridge did not fire, and offering a way through beats a spinner that
   never resolves — this is a recovery path, not a second front door, so it
   only appears once waiting has plainly failed. */
function Provisioning({ big }: { big: boolean }) {
  const { setVisible } = useWalletModal();
  const names = usePrivyWalletNames();
  const [stuck, setStuck] = useState(false);

  /* Restart the clock whenever Privy's answer changes, so a wallet arriving
     late is given its own eight seconds rather than the tail of someone
     else's. */
  useEffect(() => {
    setStuck(false);
    const id = setTimeout(() => setStuck(true), 8000);
    return () => clearTimeout(id);
  }, [names.length]);

  if (!stuck)
    return (
      <Button size={big ? "lg" : "sm"} className="min-h-11" disabled>
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        Preparing your wallet…
      </Button>
    );

  /* Privy published nothing to connect. Almost always a dashboard setting,
     which the page cannot fix and should not pretend to. */
  if (names.length === 0)
    return (
      <div className="flex flex-col items-start gap-2">
        <Button
          variant="outline"
          size={big ? "lg" : "sm"}
          className="min-h-11"
          onClick={() => setVisible(true)}
        >
          <WalletIcon className="size-4" strokeWidth={1.75} />
          Connect a wallet instead
        </Button>
        <p className="max-w-[42ch] text-caption leading-relaxed text-muted-foreground">
          You are signed in, but no Solana wallet came back. Solana embedded wallets may not be
          switched on for this Privy app.
        </p>
      </div>
    );

  /* There is a wallet; it simply has not connected. */
  return (
    <Button
      variant="outline"
      size={big ? "lg" : "sm"}
      className="min-h-11"
      onClick={() => setVisible(true)}
    >
      <WalletIcon className="size-4" strokeWidth={1.75} />
      Finish connecting
    </Button>
  );
}
