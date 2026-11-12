"use client";

import { useState } from "react";
import { keccak256, toHex } from "viem";
import { INPUTS, type Profile } from "@/lib/catalog";
import { txUrl } from "@/lib/chain";
import type { HireOutcome } from "@/lib/server/gateway";
import type { Quote } from "@/lib/server/x402";
import { payFor } from "@/lib/tx";
import { PayToggle, PriceLine, errorText, useBuyer, usePayWith } from "./pay";
import { ResultView } from "./result-view";

const VALID: Record<string, RegExp> = {
  token: /^0x[0-9a-fA-F]{40}$/,
  contract: /^0x[0-9a-fA-F]{40}$/,
  wallet: /^0x[0-9a-fA-F]{40}$/,
  tx: /^0x[0-9a-fA-F]{64}$/,
};

/**
 * Hire one agent for one job. The request goes through 402HQ's delivery check: the agent is paid, its work is
 * checked, and if it comes back empty or broken the buyer is refunded from the agent's bond.
 */
export function HirePanel({ profile, agentId, price }: { profile: Profile; agentId: number; price: string }) {
  const spec = INPUTS[profile.input];
  const needsInput = profile.input !== "none";
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "paying" | "working" | "done">("idle");
  const [step, setStep] = useState("");
  const [paidTx, setPaidTx] = useState<string>();
  const [outcome, setOutcome] = useState<HireOutcome | null>(null);
  const [error, setError] = useState("");
  const { how, setHow, ethOn, live } = usePayWith();
  const { needsWallet, connect } = useBuyer(live);

  async function run() {
    if (needsInput && !VALID[profile.input]?.test(input)) return setError(`Enter a ${spec.label.toLowerCase()}`);
    if (needsWallet) return connect();
    setError("");
    setOutcome(null);
    setPaidTx(undefined);
    try {
      const url = `/api/hire/${live ? agentId : profile.slug}`;
      const body = JSON.stringify({ input });
      const headers: Record<string, string> = { "content-type": "application/json" };
      setPhase("working");
      let res = await fetch(url, { method: "POST", headers, body });
      if (res.status === 402) {
        const quote = ((await res.json()) as Quote).accepts[0];
        setPhase("paying");
        const jobId = keccak256(toHex(`${profile.slug}-${input}-${Date.now()}-${Math.random()}`));
        setPaidTx(await payFor(how, quote.agentId, quote.maxAmountRequired, jobId, setStep));
        setPhase("working");
        res = await fetch(url, { method: "POST", headers: { ...headers, "x-payment": jobId }, body });
      }
      const json = (await res.json()) as HireOutcome | { error?: string };
      if (!("status" in json)) throw new Error(json.error ?? `HTTP ${res.status}`);
      setOutcome(json);
      setPhase("done");
    } catch (e) {
      setError(errorText(e));
      setPhase("idle");
    }
  }

  const busy = phase === "paying" || phase === "working";
  const cta = needsWallet ? "Connect wallet" : phase === "paying" ? "Paying…" : phase === "working" ? `${profile.name} is working…` : `Hire ${profile.name}`;

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="space-y-3"
      >
        {needsInput && (
          <div>
            <label className="cap mb-1.5 block" htmlFor="job-input">
              {spec.label}
            </label>
            <input id="job-input" value={input} onChange={(e) => setInput(e.target.value.trim())} placeholder={spec.placeholder} className="field h-12" spellCheck={false} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={busy} className="btn btn-primary h-12 px-7">
            {cta}
          </button>
          {live && <PayToggle how={how} setHow={setHow} ethOn={ethOn} />}
          {needsInput && spec.example && (
            <button type="button" onClick={() => setInput(spec.example!.value)} className="chip hover:border-accent hover:text-accent">
              Try {spec.example.label}
            </button>
          )}
        </div>
        <div className="text-xs">
          <PriceLine price={price} how={live ? how : undefined} />
          {!live && <span className="ml-3 text-warn">Preview: no money moves</span>}
          {step && phase === "paying" && <span className="ml-3 text-accent">{step}</span>}
        </div>
      </form>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {outcome && (
        <div className="mt-6 border-t border-line pt-6">
          {paidTx && (
            <a href={txUrl(paidTx)} target="_blank" rel="noreferrer" className="cap mb-3 block !text-accent hover:underline">
              Payment ↗
            </a>
          )}
          {outcome.status === "delivered" && <ResultView result={outcome.result} />}
          {outcome.status === "refunded" && (
            <div className="animate-rise rounded-lg border border-warn/50 bg-warn/5 p-5">
              <div className="chip border-warn text-warn">Refunded</div>
              <p className="mt-3 text-lg font-medium leading-snug">
                {profile.name} took the job and didn’t deliver: {outcome.reason}.
              </p>
              <p className="mt-2 text-sm text-muted">
                {outcome.preview
                  ? `On the live market, your ${outcome.amount} $WIF would come back from ${profile.name}’s bond, with a 10% penalty burned on top.`
                  : `Your ${outcome.amount} $WIF came back from ${profile.name}’s bond, and a 10% penalty was burned on top. Its trust score just dropped.`}
              </p>
              {outcome.tx && (
                <a href={txUrl(outcome.tx)} target="_blank" rel="noreferrer" className="link num mt-3 inline-block text-xs">
                  Refund transaction ↗
                </a>
              )}
            </div>
          )}
          {outcome.status === "error" && <p className="text-sm text-danger">{outcome.reason}</p>}
        </div>
      )}
    </div>
  );
}
