/* Two experiences, not one.

   Signed out, Float is a website: a top bar, an argument, and evidence anyone
   can check. Signed in, it is an application: a sidebar, your account, your
   position, the next thing to do.

   Keeping them apart is the point. The app's chrome makes no sense to a
   stranger — "Your account" when you have no account, a five-step pipeline
   before you have asked for anything — and showing it anyway is what makes a
   product read as somebody's internal tool.

   The two public pages, the comparison and the explanation, are deliberately
   reachable from both. They are the case for the product when you are outside
   it and the reference for it when you are in. */

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AppShell, type Tab } from "@/components/AppShell";
import { SiteShell } from "@/components/SiteShell";
import Landing from "@/screens/Landing";
import Journey from "@/screens/Journey";
import Profile from "@/screens/Profile";
import Compare from "@/screens/Compare";
import About from "@/screens/About";
import { useConnected } from "@/lib/useConnected";

const TITLES: Record<Tab, string> = {
  account: "Your account",
  profile: "Your profile",
  compare: "Why terms differ",
  about: "How this works",
};

export default function App() {
  const [tab, setTab] = useState<Tab>("account");
  const { publicKey } = useWallet();
  const { position, loading, refresh } = useConnected();

  const page =
    tab === "compare" ? <Compare /> :
    tab === "about" ? <About /> :
    null;

  /* Signed out: the website. */
  if (!publicKey) {
    return (
      <SiteShell tab={tab} setTab={setTab}>
        {page ? (
          /* Compare and About were written for the app's column; the website
             has no container of its own, so they get one here. */
          <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">{page}</div>
        ) : (
          <Landing go={setTab} />
        )}
      </SiteShell>
    );
  }

  /* Signed in: the application. */
  return (
    <AppShell tab={tab} setTab={setTab} title={TITLES[tab]}>
      {tab === "account" && <Journey position={position} loading={loading} refresh={refresh} />}
      {tab === "profile" && <Profile position={position} loading={loading} />}
      {page}
    </AppShell>
  );
}
