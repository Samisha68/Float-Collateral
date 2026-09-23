import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Anchor and web3.js reach for Node globals. Point "buffer" at the npm package
// rather than letting Vite externalise it, which leaves Buffer undefined at
// runtime in a production build even when the dev server appears to work.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { buffer: "buffer/" },
  },
  define: {
    "process.env": {},
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["buffer"],
  },
});
