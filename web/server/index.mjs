/* Float's verifier service.

   One job: approve a business so it can borrow. It exists because
   `verify_business` must be signed by the market's verifier, and a browser
   cannot hold that key. This is the same split Float's production app uses,
   and it is the honest shape: a business applies, Float reviews, Float
   approves. The borrower never holds the authority that approves it.

   Sensitive KYB stays here and never reaches the chain. What goes on chain is
   a sha256 of the canonical application, so an approval can be tied back to
   the exact evidence it was granted against without publishing any of it.

   This is a demo verifier. It approves every well-formed application, and it
   says so on screen and in the README. It is not a compliance system, and it
   must not be exposed publicly holding a key that matters. */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, ExtensionType, getMintLen,
  createInitializeMintInstruction, createInitializeTransferFeeConfigInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync, mintTo,
} from "@solana/spl-token";
import anchor from "@coral-xyz/anchor";
import BN from "bn.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const STORE = path.join(HERE, "applications.json");
const DEMO_STORE = path.join(HERE, "demo-collateral.json");

/* Every approved business gets the same limit. Sizing an individual limit is a
   credit decision, and inventing one here would be dressing a constant up as
   underwriting. Reputation changes the price, never this number. */
const CREDIT_LIMIT = new BN(10_000_000_000); // $10,000

/* The demo collateral token, modelled on T-OpenAI: Token-2022, 9 decimals,
   a 20bps transfer fee. The fee is the point — it is what makes the vault
   receive less than the borrower sent. */
const DEMO_DECIMALS = 9;
const DEMO_FEE_BPS = 20;
const DEMO_PRICE = 40_000_000;          // $40.00 a token
const DEMO_GRANT = 500_000_000_000n;    // 500 tokens, nominally $20,000

const JURISDICTIONS = ["United States", "United Kingdom", "India", "Singapore", "Germany", "Other"];
const COMPANY_TYPES = ["Private limited", "LLC", "Corporation", "Partnership", "Sole trader"];

const idl = JSON.parse(fs.readFileSync(path.join(HERE, "../src/lib/float_credit.json"), "utf8"));

const verifier = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      fs.readFileSync(
        process.env.VERIFIER_KEY || path.join(os.homedir(), ".config/solana/id.json"),
        "utf8",
      ),
    ),
  ),
);
const connection = new Connection(RPC, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(verifier), {
  commitment: "confirmed",
});
const program = new anchor.Program(idl, provider);
const V = Buffer.from([2]);
const pda = (...s) => PublicKey.findProgramAddressSync(s, program.programId)[0];
const marketPda = pda(Buffer.from("market"), V);

const read = () => (fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, "utf8")) : {});
const write = (d) => fs.writeFileSync(STORE, JSON.stringify(d, null, 2) + "\n");

/* The hash that goes on chain. A JSON array in a fixed field order, so the
   same application always produces the same reference and no field's contents
   can be mistaken for a separator. */
function kybReference(a) {
  const canonical = JSON.stringify([
    a.legalName,
    a.registrationNumber,
    a.jurisdiction,
    a.companyType,
    a.representative,
    a.documentName || "",
  ]);
  return createHash("sha256").update(canonical).digest();
}

function validate(body) {
  const errors = [];
  const need = (k, label, max = 120) => {
    const v = (body[k] || "").trim();
    if (!v) errors.push(`${label} is required.`);
    else if (v.length > max) errors.push(`${label} is too long.`);
    return v;
  };
  const legalName = need("legalName", "Legal business name");
  const registrationNumber = need("registrationNumber", "Registration number", 64);
  const representative = need("representative", "Authorised representative");
  const jurisdiction = (body.jurisdiction || "").trim();
  const companyType = (body.companyType || "").trim();
  if (!JURISDICTIONS.includes(jurisdiction)) errors.push("Select a jurisdiction.");
  if (!COMPANY_TYPES.includes(companyType)) errors.push("Select a company type.");

  let wallet = null;
  try {
    wallet = new PublicKey(body.wallet);
  } catch {
    errors.push("A connected wallet is required.");
  }

  return {
    errors,
    wallet,
    application: {
      legalName,
      registrationNumber,
      jurisdiction,
      companyType,
      representative,
      documentName: (body.documentName || "").trim().slice(0, 160),
    },
  };
}

const json = (res, code, body) => {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/meta") {
    return json(res, 200, {
      verifier: verifier.publicKey.toBase58(),
      market: marketPda.toBase58(),
      programId: program.programId.toBase58(),
      creditLimit: CREDIT_LIMIT.toString(),
      jurisdictions: JURISDICTIONS,
      companyTypes: COMPANY_TYPES,
      demoVerifier: true,
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/business/")) {
    const w = url.pathname.split("/").pop();
    const saved = read()[w];
    return json(res, 200, saved ? { applied: true, ...saved.publicView } : { applied: false });
  }

  if (req.method === "POST" && url.pathname === "/api/apply") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 64_000) {
        req.destroy();
        return;
      }
    }
    let parsed;
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      return json(res, 400, { errors: ["Malformed request."] });
    }

    const { errors, wallet, application } = validate(parsed);
    if (errors.length) return json(res, 400, { errors });

    const reference = kybReference(application);
    try {
      const sig = await program.methods
        .verifyBusiness(Array.from(reference), CREDIT_LIMIT)
        .accounts({
          verifier: verifier.publicKey,
          market: marketPda,
          borrower: wallet,
          verification: pda(Buffer.from("verification"), wallet.toBuffer()),
          record: pda(Buffer.from("record"), wallet.toBuffer()),
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const store = read();
      store[wallet.toBase58()] = {
        /* The application itself stays here. Only the hash was published. */
        application,
        publicView: {
          legalName: application.legalName,
          jurisdiction: application.jurisdiction,
          companyType: application.companyType,
          kybReference: reference.toString("hex"),
          approvedAt: new Date().toISOString(),
          signature: sig,
        },
      };
      write(store);

      return json(res, 200, { ok: true, signature: sig, ...store[wallet.toBase58()].publicView });
    } catch (e) {
      const msg = e?.error?.errorMessage || e?.message || String(e);
      return json(res, 502, { errors: [`Verification failed on chain: ${msg}`] });
    }
  }

  /* ── The demo collateral token ─────────────────────────────────────────

     A judge who never launched a token on Meteora has nothing to pledge, and
     a product that dead-ends its evaluator is not a product. So Float hands
     out a test collateral token: Token-2022, 9 decimals, a 20bps transfer
     fee, modelled on T-OpenAI. Float posts its price too, because a token
     nobody has valued cannot secure anything.

     This exists only because the market and the price publisher are both
     Float's own key on devnet. It is a demo faucet, it says so on the screen
     it appears on, and there is no version of it that belongs on mainnet. */

  if (req.method === "POST" && url.pathname === "/api/demo-collateral") {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4_000) { req.destroy(); return; }
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, { errors: ["Malformed request."] });
    }

    let recipient;
    try {
      recipient = new PublicKey(String(body.wallet || "").trim());
    } catch {
      return json(res, 400, { errors: ["That is not a valid wallet address."] });
    }

    try {
      const store = fs.existsSync(DEMO_STORE)
        ? JSON.parse(fs.readFileSync(DEMO_STORE, "utf8"))
        : {};

      /* One mint for the whole demo. Every judge holds the same token, which
         means one posted price covers all of them and the price stays fresh
         for everybody rather than going stale per wallet. */
      let mint = store.mint ? new PublicKey(store.mint) : null;
      if (!mint) {
        const kp = Keypair.generate();
        const len = getMintLen([ExtensionType.TransferFeeConfig]);
        const rent = await connection.getMinimumBalanceForRentExemption(len);
        const tx = new Transaction().add(
          SystemProgram.createAccount({
            fromPubkey: verifier.publicKey, newAccountPubkey: kp.publicKey,
            space: len, lamports: rent, programId: TOKEN_2022_PROGRAM_ID,
          }),
          createInitializeTransferFeeConfigInstruction(
            kp.publicKey, verifier.publicKey, verifier.publicKey,
            DEMO_FEE_BPS, BigInt("18446744073709551615"), TOKEN_2022_PROGRAM_ID,
          ),
          createInitializeMintInstruction(
            kp.publicKey, DEMO_DECIMALS, verifier.publicKey, null, TOKEN_2022_PROGRAM_ID,
          ),
        );
        await provider.sendAndConfirm(tx, [kp]);
        mint = kp.publicKey;
        store.mint = mint.toBase58();
        fs.writeFileSync(DEMO_STORE, JSON.stringify(store, null, 2) + "\n");
      }

      /* The price feed goes stale in five minutes, so it is refreshed on
         every request rather than only when the mint is created. */
      await program.methods
        .postPrice(new BN(DEMO_PRICE))
        .accounts({
          publisher: verifier.publicKey,
          market: marketPda,
          collateralMint: mint,
          priceFeed: pda(Buffer.from("price"), mint.toBuffer()),
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const ata = getAssociatedTokenAddressSync(mint, recipient, false, TOKEN_2022_PROGRAM_ID);
      await provider.sendAndConfirm(
        new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(
          verifier.publicKey, ata, recipient, mint, TOKEN_2022_PROGRAM_ID,
        )),
        [],
      );
      const sig = await mintTo(
        connection, verifier, mint, ata, verifier, DEMO_GRANT, [], undefined, TOKEN_2022_PROGRAM_ID,
      );

      return json(res, 200, {
        ok: true,
        mint: mint.toBase58(),
        decimals: DEMO_DECIMALS,
        transferFeeBps: DEMO_FEE_BPS,
        amount: DEMO_GRANT.toString(),
        price: String(DEMO_PRICE),
        signature: sig,
      });
    } catch (e) {
      const msg = e?.error?.errorMessage || e?.message || String(e);
      return json(res, 502, { errors: [`Could not issue the demo token: ${msg}`] });
    }
  }

  return json(res, 404, { errors: ["Not found."] });
});

server.listen(PORT, () => {
  console.log(`Float verifier on :${PORT}`);
  console.log(`  verifier  ${verifier.publicKey.toBase58()}`);
  console.log(`  market    ${marketPda.toBase58()}`);
  console.log(`  rpc       ${RPC}`);
});
