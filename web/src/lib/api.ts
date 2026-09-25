/* Float's verifier, from the browser. */

const BASE = (import.meta as any).env?.VITE_API_URL || "http://localhost:3001";

async function call(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw body;
  return body;
}

export const API = {
  meta: () => call("/api/meta"),
  business: (wallet: string) => call(`/api/business/${wallet}`),
  apply: (application: Record<string, string>) =>
    call("/api/apply", { method: "POST", body: JSON.stringify(application) }),
  /* Devnet only. Mints a test collateral token and posts a price for it, so
     a visitor with no token of their own can still walk the token rail. */
  demoCollateral: (wallet: string) =>
    call("/api/demo-collateral", { method: "POST", body: JSON.stringify({ wallet }) }),
};

export type DemoCollateral = {
  mint: string;
  decimals: number;
  transferFeeBps: number;
  amount: string;
  price: string;
  signature: string;
};

export async function demoCollateral(wallet: string): Promise<DemoCollateral> {
  try {
    return await API.demoCollateral(wallet);
  } catch (e: any) {
    throw new Error(e?.errors?.[0] || "Could not issue a test token.");
  }
}
