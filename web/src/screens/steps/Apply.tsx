/* KYB.

   Deliberately short. Everything asked for here is something a real business
   has to hand, and nothing is asked twice. The documents and the registration
   number stay with Float; what reaches the chain is a sha256 of the
   application, so an approval can be tied back to the evidence it was granted
   against without publishing any of it. */

import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { Block } from "../../components/ui";
import { API } from "../../lib/api";

type Meta = { jurisdictions: string[]; companyTypes: string[]; creditLimit: string };

export default function Apply({ wallet, onDone }: { wallet: PublicKey; onDone: () => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [form, setForm] = useState({
    legalName: "", registrationNumber: "", jurisdiction: "",
    companyType: "", representative: "", documentName: "",
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { API.meta().then(setMeta).catch(() => setMeta(null)); }, []);

  const set = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    setBusy(true); setErrors([]);
    try {
      await API.apply({ ...form, wallet: wallet.toBase58() });
      onDone();
    } catch (e: any) {
      setErrors(e.errors ?? [e?.message ?? String(e)]);
    } finally {
      setBusy(false);
    }
  };

  if (!meta)
    return (
      <Block title="Verify your business">
        <p className="note">
          Float's verifier is not reachable. Start it with <code>npm run verifier</code> and
          reload.
        </p>
      </Block>
    );

  return (
    <Block title="Verify your business">
      <p>
        Float lends to verified businesses. This takes a minute, and it is what sets your
        approved credit limit.
      </p>

      <div className="form">
        <label className="field">
          <span>Legal business name</span>
          <input type="text" className="wide" value={form.legalName} onChange={set("legalName")} placeholder="Kettle &amp; Co Ltd" />
        </label>
        <label className="field">
          <span>Registration number</span>
          <input type="text" className="wide" value={form.registrationNumber} onChange={set("registrationNumber")} placeholder="09876543" />
        </label>
        <label className="field">
          <span>Jurisdiction</span>
          <select value={form.jurisdiction} onChange={set("jurisdiction")}>
            <option value="">Select…</option>
            {meta.jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Company type</span>
          <select value={form.companyType} onChange={set("companyType")}>
            <option value="">Select…</option>
            {meta.companyTypes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Authorised representative</span>
          <input type="text" className="wide" value={form.representative} onChange={set("representative")} placeholder="A. Director" />
        </label>
        <label className="field">
          <span>Registration document</span>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => setForm({ ...form, documentName: e.target.files?.[0]?.name ?? "" })}
          />
          <small className="note">
            The file stays on your device. Only its name is part of the application, and only a
            hash of the application reaches the chain.
          </small>
        </label>
      </div>

      <div className="actions">
        <button className="action primary" disabled={busy} onClick={submit}>
          {busy ? "Submitting…" : "Submit application"}
        </button>
      </div>

      {errors.length > 0 && (
        <ul className="errors">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}

      <p className="note">
        Float reviews the application and approves it on chain. In this demo the reviewer
        approves every well-formed application and grants the same limit to everyone, so it is an
        authority check rather than a compliance system.
      </p>
    </Block>
  );
}
