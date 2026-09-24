/* Wallet connection.

   Devnet, and deliberately unopinionated about which wallet: the adapter
   discovers anything that speaks the Wallet Standard, which is every wallet a
   judge is likely to already have installed. */

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { RPC } from "./lib/chain";
import "@solana/wallet-adapter-react-ui/styles.css";

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

/* The adapter ships a button with its own visual opinions, none of which
   match DESIGN.md. This is the same behaviour wearing Float's clothes. */
export function ConnectButton({ lead = false }: { lead?: boolean } = {}) {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const cls = lead ? "link lead" : "link";

  if (connecting) return <span className="note">Connecting…</span>;

  if (publicKey) {
    return (
      <button className={cls} onClick={() => disconnect()}>
        Disconnect
      </button>
    );
  }
  return (
    <button className={cls} onClick={() => setVisible(true)}>
      Connect wallet
    </button>
  );
}
