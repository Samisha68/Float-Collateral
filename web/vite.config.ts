import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Anchor and web3.js reach for Node's Buffer.
      buffer: "buffer/",
      "@": path.resolve(__dirname, "./src"),
    },
    // The wallet adapter packages each depend on React. Without deduping, Vite
    // serves more than one copy and every hook call throws.
    dedupe: ["react", "react-dom"],
  },
  define: { "process.env": {}, global: "globalThis" },
  optimizeDeps: { include: ["buffer"] },
});
