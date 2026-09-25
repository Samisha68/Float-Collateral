import "./polyfill";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { Wallet } from "@/wallet";
import { Privy } from "@/privy";
import "./index.css";

/* Privy sits outside the wallet provider, not beside it.

   It registers its embedded wallet into the Wallet Standard registry, and the
   adapter reads that registry when it mounts, so Privy has to be the outer
   one. Inside out, the adapter would already have taken its census before
   Privy had anything to declare. */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Privy>
      <Wallet>
        <App />
      </Wallet>
    </Privy>
  </StrictMode>,
);
