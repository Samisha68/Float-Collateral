/* Wallet connection.

   Devnet, and deliberately unopinionated about which wallet: the adapter
   discovers anything speaking the Wallet Standard, which is every wallet a
   judge is likely to already have. */

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Wallet as WalletIcon, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** The connected address, so it is visible without opening anything. */
export function WalletChip() {
  const { publicKey } = useWallet();
  if (!publicKey) return null;
  return (
    <span className="hidden rounded-md border bg-muted/50 px-2.5 py-1 font-mono text-micro text-muted-foreground sm:inline">
      {shortKey(publicKey.toBase58())}
    </span>
  );
}

export function ConnectButton({ size = "sm" }: { size?: "sm" | "lg" }) {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (connecting)
    return (
      <Button size={size === "lg" ? "lg" : "sm"} className="min-h-11" disabled>
        <WalletIcon className="size-4" strokeWidth={1.75} />
        Connecting…
      </Button>
    );

  if (publicKey)
    return (
      <Button variant="outline" size="sm" className="min-h-11" onClick={() => disconnect()}>
        <LogOut className="size-4" strokeWidth={1.75} />
        Disconnect
      </Button>
    );

  return (
    <Button size={size === "lg" ? "lg" : "sm"} className="min-h-11" onClick={() => setVisible(true)}>
      <WalletIcon className="size-4" strokeWidth={1.75} />
      Connect wallet
    </Button>
  );
}
