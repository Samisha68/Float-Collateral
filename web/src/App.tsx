import { useState } from "react";
import Journey from "./screens/Journey";
import Compare from "./screens/Compare";
import About from "./screens/About";
import { Key } from "./components/ui";
import { ConnectButton } from "./wallet";
import { useConnected } from "./lib/useConnected";
import { config } from "./lib/chain";

type Tab = "journey" | "compare" | "about";

const TABS: [Tab, string][] = [
  ["journey", "Your account"],
  ["compare", "Why terms differ"],
  ["about", "How this works"],
];

export default function App() {
  const [tab, setTab] = useState<Tab>("journey");
  const { position, loading, refresh } = useConnected();

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
        <div className="rail-group">
          <ConnectButton />
        </div>
      </aside>

      <main>
        {tab === "journey" && <Journey position={position} loading={loading} refresh={refresh} />}
        {tab === "compare" && <Compare />}
        {tab === "about" && <About />}
      </main>

      <footer className="colophon">
        <strong>Devnet.</strong> No real money moves. The USDC is a test mint Float controls and
        verification is done by Float's own key. Program <Key value={config.programId} />.
      </footer>
    </div>
  );
}
