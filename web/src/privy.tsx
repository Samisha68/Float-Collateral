/* Signing in without a wallet.

   Float's borrowers are businesses, and a business does not necessarily have
   a browser extension holding a Solana keypair. Requiring one turns "apply
   for credit" into "install software first", which is the wrong first step
   for someone whose actual problem is payroll on Friday.

   Privy fixes that: sign in with email or Google, and Privy provisions an
   embedded Solana wallet the user controls. Nothing else about Float changes
   — the wallet is a real signer, the transactions are the same transactions,
   and the chain cannot tell the difference.

   The integration deliberately does not fork the app in two. Privy's embedded
   wallet implements the Wallet Standard, which is the same interface Phantom
   and Solflare speak, so it is registered into the same registry the adapter
   already reads. Everything downstream — every `useWallet()`, every action,
   every screen — stays exactly as it was and never learns Privy exists.

   The app ID is a public client identifier. It is visible in the bundle of
   any deployed Privy app by design; the secret that matters is the app
   secret, which lives on Privy's side and is not used here. */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { PrivyProvider, usePrivy, useLogin, useLogout } from "@privy-io/react-auth";
import { useStandardWallets } from "@privy-io/react-auth/solana";
import { getWallets } from "@wallet-standard/app";

export const PRIVY_APP_ID = (import.meta as any).env?.VITE_PRIVY_APP_ID ?? "";

/** Whether sign-in-with-email is available at all. Without an app ID Float
    still works; it just asks for a wallet like it always did. */
export const privyEnabled = () => PRIVY_APP_ID.length > 0;

/** Push Privy's embedded wallet into the Wallet Standard registry.

    `registerWallet` returns an unregister function. Privy re-creates its
    wallet objects as the user's account changes, so this re-runs and cleans
    up after itself rather than accumulating duplicates in the picker. */
function StandardWalletBridge() {
  const { wallets, ready } = useStandardWallets();

  useEffect(() => {
    if (!ready || wallets.length === 0) return;
    const { register } = getWallets();
    const unregister = register(...(wallets as any));
    return () => {
      try { unregister(); } catch { /* already gone */ }
    };
  }, [ready, wallets]);

  return null;
}

export function Privy({ children }: { children: ReactNode }) {
  if (!privyEnabled()) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        /* Solana only. Float is a Solana product and an Ethereum wallet the
           user never asked for is a support question waiting to happen. */
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          ethereum: { createOnLogin: "off" },
        },
        /* Email and Google only. Privy's modal can also connect an external
           wallet, but Float already has its own button for that, wired to the
           adapter the rest of the app reads. Offering both put two different
           routes to the same place on one screen, one of which bypassed the
           registry everything downstream depends on. */
        loginMethods: ["email", "google"],
        appearance: {
          theme: "light",
          accentColor: "#000000",
          logo: `${window.location.origin}/float-favicon.svg`,
          walletChainType: "solana-only",
        },
        solana: {
          rpcs: {
            "solana:devnet": { rpc: (import.meta as any).env?.VITE_RPC_URL || "https://api.devnet.solana.com" },
          },
        } as any,
      }}
    >
      <StandardWalletBridge />
      <SessionProvider>{children}</SessionProvider>
    </PrivyProvider>
  );
}

/* The session, behind a context rather than a conditional hook.

   Whether Privy is configured is a build-time constant, so branching on it
   inside a hook would in practice never change between renders — but it is
   still a conditional hook call, and the rule exists so that "in practice"
   never has to be reasoned about. The provider does the branching once; every
   consumer just reads a context that is always there. */

export type PrivySession = {
  enabled: boolean;
  ready: boolean;
  authenticated: boolean;
  email: string | null;
  login: () => void;
  logout: () => Promise<void> | void;
};

const OFF: PrivySession = {
  enabled: false, ready: true, authenticated: false, email: null,
  login: () => {}, logout: () => {},
};

const SessionContext = createContext<PrivySession>(OFF);

export const usePrivySession = () => useContext(SessionContext);

function SessionProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();

  const value = useMemo<PrivySession>(
    () => ({
      enabled: true,
      ready,
      authenticated,
      email: user?.email?.address ?? (user as any)?.google?.email ?? null,
      login,
      logout,
    }),
    [ready, authenticated, user, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
