/* KYB.

   Deliberately short. Everything asked for is something a real business has to
   hand, and nothing is asked twice. Documents and the registration number stay
   with Float; what reaches the chain is a sha256 of the application, so an
   approval can be tied back to the evidence it was granted against without
   publishing any of it. */

import { useEffect, useId, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { ShieldCheck, Loader2, CircleAlert, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Note } from "../Journey";
import { API } from "@/lib/api";

type Meta = { jurisdictions: string[]; companyTypes: string[] };

/* A label with no htmlFor is not a label. Radix's SelectTrigger cannot be
   targeted by htmlFor, so it gets aria-labelledby from the same id instead. */
const Field = ({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: (ids: { id: string; labelId: string }) => React.ReactNode;
}) => {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div className="space-y-1.5">
      <label id={labelId} htmlFor={id} className="text-caption text-muted-foreground">
        {label}
      </label>
      {children({ id, labelId })}
      {hint && <p className="text-micro text-muted-foreground">{hint}</p>}
    </div>
  );
};

export default function Apply({ wallet, onDone }: { wallet: PublicKey; onDone: () => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [down, setDown] = useState(false);
  const [form, setForm] = useState({
    legalName: "", registrationNumber: "", jurisdiction: "",
    companyType: "", representative: "", documentName: "",
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { API.meta().then(setMeta).catch(() => setDown(true)); }, []);

  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  const submit = async () => {
    setBusy(true); setErrors([]);
    try {
      await API.apply({ ...form, wallet: wallet.toBase58() });
      onDone();
    } catch (e: any) {
      setErrors(e?.errors ?? [e?.message ?? String(e)]);
    } finally {
      setBusy(false);
    }
  };

  if (down)
    return (
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-lead">Verification is unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <Note icon={CircleAlert}>
            Float's verifier is not reachable. Start it with{" "}
            <code className="font-mono text-caption">npm run verifier</code> and reload.
          </Note>
        </CardContent>
      </Card>
    );

  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4.5 text-muted-foreground" strokeWidth={1.75} />
          <CardTitle className="text-lead">Verify your business</CardTitle>
        </div>
        <CardDescription className="text-meta">
          Float lends to verified businesses. This takes a minute, and it is what sets your
          approved credit limit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal business name">
            {({ id }) => (
              <Input id={id} value={form.legalName} onChange={(e) => set("legalName")(e.target.value)} placeholder="Kettle & Co Ltd" />
            )}
          </Field>
          <Field label="Registration number">
            {({ id }) => (
              <Input id={id} value={form.registrationNumber} onChange={(e) => set("registrationNumber")(e.target.value)} placeholder="09876543" />
            )}
          </Field>
          <Field label="Jurisdiction">
            {({ id, labelId }) => (
              <Select value={form.jurisdiction} onValueChange={set("jurisdiction")}>
                <SelectTrigger id={id} aria-labelledby={labelId} className="w-full">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {meta?.jurisdictions.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Company type">
            {({ id, labelId }) => (
              <Select value={form.companyType} onValueChange={set("companyType")}>
                <SelectTrigger id={id} aria-labelledby={labelId} className="w-full">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {meta?.companyTypes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Authorised representative">
            {({ id }) => (
              <Input id={id} value={form.representative} onChange={(e) => set("representative")(e.target.value)} placeholder="A. Director" />
            )}
          </Field>
          <Field
            label="Registration document"
            hint="Stays on your device. Only a hash of the application reaches the chain."
          >
            {({ id }) => (
              <label
                htmlFor={id}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-meta text-muted-foreground transition-colors hover:bg-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
              >
                <Upload className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{form.documentName || "Choose a file"}</span>
                <input
                  id={id}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="sr-only"
                  onChange={(e) => set("documentName")(e.target.files?.[0]?.name ?? "")}
                />
              </label>
            )}
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" strokeWidth={1.75} />}
            Submit application
          </Button>
          <span className="text-caption text-muted-foreground">Approval is immediate on devnet.</span>
        </div>

        {errors.length > 0 && (
          <Note icon={CircleAlert}>
            {errors.length === 1 ? errors[0] : (
              <ul className="list-disc space-y-0.5 pl-4">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </Note>
        )}

        <p className="text-caption leading-relaxed text-muted-foreground">
          Float reviews the application and approves it on chain. In this demo the reviewer
          approves every well-formed application and grants everyone the same limit, so it is an
          authority check rather than a compliance system.
        </p>
      </CardContent>
    </Card>
  );
}
