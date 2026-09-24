/* Node globals, installed before anything that needs them.

   Several Solana packages touch Buffer while their module body is evaluating,
   not inside a function. ES module imports are evaluated in order, so this has
   to be the first import in the entry file; doing the assignment inside
   main.tsx was too late and left the page blank with no error in the console,
   only a Vite log nobody was reading. */

import { Buffer } from "buffer";

(globalThis as any).Buffer ??= Buffer;
(globalThis as any).global ??= globalThis;
(globalThis as any).process ??= { env: {} };
