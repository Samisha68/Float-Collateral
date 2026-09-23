import { useState } from "react";
import Account from "./screens/Account";
import Draw from "./screens/Draw";
import Compare from "./screens/Compare";
import About from "./screens/About";
import { Disclosure, Key } from "./components/ui";
import { BORROWERS, useBorrower, type Borrower } from "./lib/useBorrower";
import { config } from "./lib/chain";

type Tab = "compare" | "account" | "draw" | "about";

const TABS: [Tab, string][] = [
  ["compare", "The argument"],
  ["account", "Credit account"],
  ["draw", "Draw"],
  ["about", "How this works"],
];

export default function App() {
  const [tab, setTab] = useState<Tab>("compare");
  const [borrower, setBorrower] = useState<Borrower>(BORROWERS[1]);
  const { state, error } = useBorrower(borrower);

  return (
    <div className="layout">
      <header className="masthead">
        <div className="wordmark">FLOAT</div>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} aria-current={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      {(tab === "account" || tab === "draw") && (
        <section style={{ marginTop: 24 }}>
          <nav className="tabs" aria-label="Select a business">
            {BORROWERS.map((b) => (
              <button
                key={b.key}
                aria-current={b.wallet === borrower.wallet}
                onClick={() => setBorrower(b)}
              >
                {b.label}
              </button>
            ))}
          </nav>
        </section>
      )}

      {tab === "compare" && <Compare />}
      {tab === "about" && <About />}

      {(tab === "account" || tab === "draw") && (
        <>
          {error && (
            <section>
              <p className="note">Could not read devnet: {error}</p>
            </section>
          )}
          {!error && !state && (
            <section>
              <p className="spinner">Reading {borrower.label} from devnet…</p>
            </section>
          )}
          {state && tab === "account" && <Account s={state} />}
          {state && tab === "draw" && <Draw s={state} />}
        </>
      )}

      <Disclosure>
        <strong>Devnet.</strong> No real money moves here. The collateral is a fee stream from a
        Meteora bonding-curve pool we launched for the demo, and the USDC is a test mint Float
        controls, because devnet has no mintable USDC. Business verification is performed by
        Float's own key, not a compliance provider. Program{" "}
        <Key value={config.programId} />.
      </Disclosure>
    </div>
  );
}
