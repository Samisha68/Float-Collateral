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

/* Which wallets Privy has put into the registry.

   Registering a wallet makes it *available* to the adapter. It does not
   connect it, and the first version of this bridge stopped there — so after
   signing in the user sat on "Preparing your wallet" while a perfectly good
   wallet waited, unselected, in a picker nobody opened.

   The adapter cannot be driven from here, because this component lives
   outside WalletProvider by necessity: the adapter reads the registry when it
   mounts, so Privy has to register first. The names travel down instead, and
   `PrivyAutoConnect` inside the provider does the selecting. */
const PrivyWalletsContext = createContext<string[]>([]);

export const usePrivyWalletNames = () => useContext(PrivyWalletsContext);

function StandardWalletBridge({ children }: { children: ReactNode }) {
  const { wallets, ready } = useStandardWallets();

  /* Only wallets that can actually be connected.

     Privy publishes its Standard Wallet before anyone signs in, holding no
     accounts. Registering that put a wallet in front of the adapter that
     could not connect: autoConnect tried, threw WalletAccountError, and the
     attempt began again — about 270 failures a second.

     An account is the thing that makes a wallet connectable, so that is the
     test. */
  const usable = useMemo(
    () => (ready ? wallets.filter((w: any) => (w.accounts?.length ?? 0) > 0) : []),
    [ready, wallets],
  );

  /* A stable key, so the effect below runs when the *set* of wallets changes
     rather than every time the hook hands back a new array. Deriving the
     names instead of storing them removes the other half of that loop: the
     old version called setNames inside the same effect whose dependency
     changed identity on every render. */
  const key = usable.map((w: any) => `${w.name}:${w.accounts[0]?.address ?? ""}`).join("|");
  const names = useMemo(
    () => usable.map((w: any) => w.name).filter(Boolean) as string[],
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (usable.length === 0) return;
    const { register } = getWallets();
    const unregister = register(...(usable as any));
    return () => {
      try { unregister(); } catch { /* already gone */ }
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <PrivyWalletsContext.Provider value={names}>{children}</PrivyWalletsContext.Provider>;
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
        /* One door, and the branching happens inside it.

           Float used to put "Sign in" and "Connect a wallet" side by side on
           every call to action, which is two doors to the same room and a
           decision the visitor should not have to make. Worse, it was
           incoherent: signing in with Privy *gives* you a wallet, so being
           asked to connect one first made no sense.

           So Privy handles all three. `useStandardWallets` is Privy's Standard
           Wallet implementation for every Solana wallet it knows about, not
           only the embedded one, so a wallet connected here reaches the
           adapter through the same bridge. */
        loginMethods: ["email", "google", "wallet"],
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
      <StandardWalletBridge>
        <SessionProvider>{children}</SessionProvider>
      </StandardWalletBridge>
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
