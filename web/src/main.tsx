import "./polyfill";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Wallet } from "./wallet";
import "./design.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Wallet>
      <App />
    </Wallet>
  </StrictMode>,
);
