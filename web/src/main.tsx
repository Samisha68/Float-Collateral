import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import App from "./App";
import "./design.css";

// Anchor and web3.js expect Node's Buffer; the browser has no such thing.
(globalThis as any).Buffer ??= Buffer;
(globalThis as any).global ??= globalThis;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
