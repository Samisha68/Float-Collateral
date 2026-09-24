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
};
