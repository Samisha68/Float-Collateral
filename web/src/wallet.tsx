/* Wallet connection.

   Devnet, and deliberately unopinionated about which wallet: the adapter
   discovers anything speaking the Wallet Standard, which is every wallet a
   judge is likely to already have. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  Wallet as WalletIcon, LogOut, Copy, Check, ExternalLink, RefreshCw, ChevronDown, User, Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { explorer } from "@/lib/format";
import { usePrivySession } from "@/privy";
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
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
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

        <DropdownMenuItem onSelect={() => setVisible(true)}>
          <RefreshCw strokeWidth={1.75} />
          Switch wallet
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={() => { void signOut(); }}>
          <LogOut strokeWidth={1.75} />
          {session.authenticated ? "Sign out" : "Disconnect"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConnectButton({
  size = "sm", onProfile,
}: { size?: "sm" | "lg"; onProfile?: () => void }) {
  const { publicKey, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const session = usePrivySession();
  const big = size === "lg";

  if (connecting)
    return (
      <Button size={big ? "lg" : "sm"} className="min-h-11" disabled>
        <WalletIcon className="size-4 animate-pulse" strokeWidth={1.75} />
        Connecting…
      </Button>
    );

  if (publicKey) return <WalletMenu onProfile={onProfile} />;

  /* Signed in, but the embedded wallet has not finished being provisioned or
     registered yet. Saying so beats showing "sign in" to someone who just
     did. */
  if (session.enabled && session.authenticated)
    return (
      <Button size={big ? "lg" : "sm"} className="min-h-11" disabled>
        <WalletIcon className="size-4 animate-pulse" strokeWidth={1.75} />
        Preparing your wallet…
      </Button>
    );

  /* Without Privy, Float asks for a browser wallet exactly as it always did. */
  if (!session.enabled)
    return (
      <Button size={big ? "lg" : "sm"} className="min-h-11" onClick={() => setVisible(true)}>
        <WalletIcon className="size-4" strokeWidth={1.75} />
        Connect wallet
      </Button>
    );

  /* With Privy, email leads. A business owner short of cash on Friday should
     not have to install a browser extension before they can ask for credit,
     and the people who already have one are the ones who will recognise
     "connect a wallet" as the secondary option. */
  return (
    <div className="flex items-center gap-2">
      <Button size={big ? "lg" : "sm"} className="min-h-11" disabled={!session.ready} onClick={session.login}>
        <Mail className="size-4" strokeWidth={1.75} />
        {big ? "Sign in to apply" : "Sign in"}
      </Button>
      <Button
        variant="outline"
        size={big ? "lg" : "sm"}
        className="min-h-11"
        onClick={() => setVisible(true)}
      >
        <WalletIcon className="size-4" strokeWidth={1.75} />
        {big ? "Connect a wallet" : "Wallet"}
      </Button>
    </div>
  );
}
