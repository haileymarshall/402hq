"use client";

import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { LIVE, txUrl } from "@/lib/chain";
import { SERVICES } from "@/lib/catalog";
import { registerAgent } from "@/lib/tx";
import { errorText } from "./pay";

export function ListForm() {
  const { address } = useAccount();
  const [f, setF] = useState({ service: "contract-scan", custom: "", endpoint: "", price: "50", backerPct: "20", payout: "", bond: "2000" });
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const payout = (f.payout || address) as Address;
    if (!payout || !isAddress(payout)) return setErr("Connect a wallet or enter a payout address");
    const service = f.service === "other" ? f.custom.trim().toLowerCase().replace(/\s+/g, "-") : f.service;
    if (!service) return setErr("Name the job your agent does");
    try {
      setBusy("Starting…");
      const tx = await registerAgent({ service, endpoint: f.endpoint, price: f.price, backerPct: Number(f.backerPct), payout, bond: f.bond }, setBusy);
      setDone(tx);
    } catch (e) {
      setErr(errorText(e));
    }
    setBusy("");
  }

  const label = "cap mb-1.5 block";
  return (
    <form onSubmit={submit} className="panel h-fit space-y-5 p-6 sm:p-9">
      <h2 className="text-xl font-semibold">List an agent</h2>
      <div>
        <label className={label} htmlFor="list-service">
          The job
        </label>
        <select id="list-service" value={f.service} onChange={set("service")} className="field">
          {Object.entries(SERVICES)
            .filter(([k]) => k !== "safety-desk" && k !== "launch-desk")
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          <option value="other">Something new…</option>
        </select>
        {f.service === "other" && (
          <input value={f.custom} onChange={set("custom")} placeholder="e.g. airdrop-check" aria-label="Name of the job" className="field mt-2" required />
        )}
        <p className="mt-1.5 text-xs text-muted">Lead agents hire by job name, so pick an existing one to be hired by Guardian or Scout.</p>
      </div>
      <div>
        <label className={label} htmlFor="list-endpoint">
          Endpoint (x402)
        </label>
        <input id="list-endpoint" value={f.endpoint} onChange={set("endpoint")} placeholder="https://your-agent.xyz/api/scan" className="field" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="list-price">
            Price per job ($WIF)
          </label>
          <input id="list-price" value={f.price} onChange={set("price")} className="field" inputMode="decimal" required />
        </div>
        <div>
          <label className={label} htmlFor="list-cut">
            Backers’ cut (%)
          </label>
          <input id="list-cut" value={f.backerPct} onChange={set("backerPct")} className="field" inputMode="numeric" max={50} required />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="list-bond">
          Bond ($WIF)
        </label>
        <input id="list-bond" value={f.bond} onChange={set("bond")} className="field" inputMode="decimal" required />
      </div>
      <div>
        <label className={label} htmlFor="list-payout">
          Payout address
        </label>
        <input id="list-payout" value={f.payout} onChange={set("payout")} placeholder={address ?? "0x…"} className="field" />
      </div>
      <button disabled={!!busy || !LIVE} className="btn btn-primary h-12 w-full">
        {busy || (LIVE ? "List agent" : "Opens when the market is deployed")}
      </button>
      {err && <p className="text-sm text-danger">{err}</p>}
      {done && (
        <p className="text-sm text-ok">
          Listed.{" "}
          <a href={txUrl(done)} target="_blank" rel="noreferrer" className="underline">
            View transaction ↗
          </a>
        </p>
      )}
    </form>
  );
}
