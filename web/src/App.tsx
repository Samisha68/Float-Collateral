import { useState } from "react";
import Compare from "./screens/Compare";
import Account from "./screens/Account";
import Draw from "./screens/Draw";
import About from "./screens/About";
import { Key } from "./components/ui";
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
  const perBusiness = tab === "account" || tab === "draw";

  return (
    <div className="shell">
      <aside className="rail">
        <img className="mark" src="/float-favicon.svg" alt="Float" />
        <nav>
          {TABS.map(([id, label]) => (
            <button key={id} aria-current={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        {perBusiness && (
          <div className="rail-group">
            <div className="rail-label">Business</div>
            <nav>
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
          </div>
        )}

      </aside>

      <main>
        {tab === "compare" && <Compare />}
        {tab === "about" && <About />}
        {perBusiness && (
          <>
            {error && <p className="note">Could not read devnet. {error}</p>}
            {!error && !state && <p className="spinner">Reading {borrower.label} from devnet…</p>}
            {state && tab === "account" && <Account s={state} />}
            {state && tab === "draw" && <Draw s={state} />}
          </>
        )}
      </main>

      <footer className="colophon">
        <strong>Devnet.</strong> No real money moves. The USDC is a test mint Float controls and
        the pool is one we launched. Program <Key value={config.programId} />.
      </footer>
    </div>
  );
}
