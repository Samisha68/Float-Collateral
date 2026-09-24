import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Anchor and web3.js reach for Node globals. Point "buffer" at the npm package
// rather than letting Vite externalise it, which leaves Buffer undefined at
// runtime in a production build even when the dev server appears to work.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { buffer: "buffer/" },
    // The wallet adapter packages each depend on React. Without deduping, Vite
    // serves more than one copy and every hook call throws.
    dedupe: ["react", "react-dom"],
  },
  define: {
    "process.env": {},
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["buffer"],
  },
});
