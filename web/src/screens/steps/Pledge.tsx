/* Pledging a fee stream.

   The one step that gives something up, so it explains itself before asking.
   The pool is checked against every rule the program enforces before the
   wallet is prompted: a signature request that then fails is worse than a
   refusal that explains itself. */

import { useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { Block, Key } from "../../components/ui";
import * as act from "../../lib/actions";
import { Outcome } from "../Journey";
import type { Position } from "../../lib/useConnected";

export default function Pledge({
  wallet, send, onDone,
}: { wallet: PublicKey; send: act.SendFn; onDone: () => void; position: Position }) {
  const [address, setAddress] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<act.PoolCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const verify = async () => {
    setChecking(true); setCheck(null); setError(null);
    try {
      setCheck(await act.checkPool(address, wallet));
    } finally {
      setChecking(false);
    }
  };

  const pledge = async () => {
    if (!check?.ok) return;
    setBusy(true); setError(null); setDone(null);
    try {
      setDone(await act.pledgePool(wallet, check.pool, check.config, send));
      onDone();
    } catch (e: any) {
      setError(e?.error?.errorMessage || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Block title="Pledge a fee stream">
      <p>
        Float lends against the trading fees your Meteora pool earns you. To secure a loan you
        hand Float the pool's <strong>creator role</strong>, which is the authority Meteora
        requires to claim those fees.
      </p>
      <p className="note">
        While it is pledged you cannot claim your pool's fees and Float can. Nothing else about
        the pool changes: it keeps trading, you keep its tokens, and the role comes back to you
        when the loan is repaid.
      </p>

      <div className="ask" style={{ marginTop: "1.75rem" }}>
        <label className="field grow">
          <span>Your pool address on devnet</span>
          <input
            type="text"
            className="wide mono-input"
            value={address}
            onChange={(e) => { setAddress(e.target.value); setCheck(null); }}
            placeholder="3svMNFGD4XC11Lf6K1Mq4aEGS5LjfbU1AYa9BagXAXX4"
          />
        </label>
        <button className="action" disabled={!address.trim() || checking} onClick={verify}>
          {checking ? "Checking…" : "Check pool"}
        </button>
      </div>

      {check && !check.ok && <p className="note outcome">{check.reason}</p>}

      {check?.ok && (
        <>
          <p className="note outcome">
            This pool is yours, it trades, it is quoted in USDC, and it pays you{" "}
            {check.creatorFeePct}% of its trading fees. <Key value={check.pool.toBase58()} />
          </p>
          <div className="actions">
            <button className="action primary" disabled={busy} onClick={pledge}>
              {busy ? "Pledging…" : "Pledge this pool to Float"}
            </button>
          </div>
        </>
      )}

      <Outcome error={error} done={done} />
    </Block>
  );
}
