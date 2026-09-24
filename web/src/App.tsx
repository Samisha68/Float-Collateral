import { useState } from "react";
import { AppShell, type Tab } from "@/components/AppShell";
import Journey from "@/screens/Journey";
import Compare from "@/screens/Compare";
import About from "@/screens/About";
import { useConnected } from "@/lib/useConnected";

const TITLES: Record<Tab, string> = {
  account: "Your account",
  compare: "Why terms differ",
  about: "How this works",
};

export default function App() {
  const [tab, setTab] = useState<Tab>("account");
  const { position, loading, refresh } = useConnected();

  return (
    <AppShell tab={tab} setTab={setTab} title={TITLES[tab]}>
      {tab === "account" && <Journey position={position} loading={loading} refresh={refresh} />}
      {tab === "compare" && <Compare />}
      {tab === "about" && <About />}
    </AppShell>
  );
}
