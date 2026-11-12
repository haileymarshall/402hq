"use client";

import { useRef, useState } from "react";
import { isAddress, keccak256, toHex } from "viem";
import type { Report, ServiceResult } from "@/lib/agents/services";
import { INPUTS, SERVICES, type Profile } from "@/lib/catalog";
import { txUrl } from "@/lib/chain";
import type { Hunted, TeamEvent } from "@/lib/server/teams";
import type { Quote } from "@/lib/server/x402";
import { payFor } from "@/lib/tx";
import { TeamGraph, teamNodes, type NodeState, type GraphNode } from "./team-graph";
import { PayToggle, PriceLine, errorText, readEvents, useBuyer, usePayWith } from "./pay";
import { HuntCard, ReportCard } from "./result-view";

type LogLine = { id: number; tone: "info" | "ok" | "warn" | "bad" | "pay"; text: string; tx?: string };
const TONES = { info: "var(--color-sky)", ok: "var(--color-ok)", warn: "var(--color-warn)", bad: "var(--color-danger)", pay: "var(--color-accent)" };
type Answer = { kind: "report"; report: Report; results: ServiceResult[] } | { kind: "hunt"; launches: Hunted[]; opened: number; windowHours: number };

/**
 * Hire a lead agent and watch it work: it checks each specialist against its wallet's rules, pays it, checks what
 * comes back, and gets a refund when an agent fails.
 */
export function TeamRunner({ lead, price }: { lead: Profile; price: string }) {
  const needsToken = lead.input === "token";
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<"idle" | "paying" | "running" | "done" | "error">("idle");
  const [step, setStep] = useState("");
  const [nodes, setNodes] = useState<GraphNode[]>(() => teamNodes(lead.slug));
  const [log, setLog] = useState<LogLine[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const paid = useRef(0);
  const hired = useRef(new Set<string>());
  const ids = useRef(0);
  const { how, setHow, ethOn, live } = usePayWith();
  const { needsWallet, connect } = useBuyer(live);

  const push = (tone: LogLine["tone"], text: string, tx?: string) => setLog((l) => [...l, { id: ids.current++, tone, text, tx }]);
  /** a hire can name an agent that isn't one of ours: add it to the picture the first time it shows up */
  const mark = (e: { name: string; service: string }, state: NodeState, bump = false) =>
    setNodes((ns) => {
      const known = ns.some((n) => n.name === e.name);
      const base = known ? ns : [...ns, { name: e.name, label: SERVICES[e.service as keyof typeof SERVICES]?.label ?? e.service, state: "idle" as NodeState, jobs: 0 }];
      return base.map((n) => (n.name === e.name ? { ...n, state, jobs: n.jobs + (bump ? 1 : 0) } : n));
    });

  function onEvent(e: TeamEvent) {
    const about = "target" in e && e.target ? ` on ${e.target}` : "";
    switch (e.type) {
      case "start":
        setPreview(e.preview);
        push("info", e.input ? `${lead.name} took the job for ${e.input.slice(0, 10)}…` : `${lead.name} took the job`);
        break;
      case "consider":
        if (e.ok) mark(e, "considering");
        else {
          mark(e, "skipped");
          push("warn", `${lead.name} passed over ${e.name}: ${e.reason}`);
        }
        break;
      case "paid":
        mark(e, "paid", true);
        paid.current += Number(e.price);
        hired.current.add(e.name);
        push("pay", `${lead.name} hired ${e.name}${about} for ${e.price} $WIF`, e.tx);
        break;
      case "delivered":
        mark(e, "delivered");
        push("ok", `${e.name}${about}: ${e.result.summary}`);
        break;
      case "failed":
        mark(e, "failed");
        push("bad", `${e.name}${about} failed: ${e.reason}`);
        break;
      case "refunded":
        mark(e, "refunded");
        paid.current -= Number(e.amount);
        push("warn", `${e.amount} $WIF refunded from ${e.name}'s bond, and a penalty burned`, e.tx);
        break;
      case "report":
        setNodes((ns) => ns.map((n) => (n.state === "paid" ? { ...n, state: "delivered" } : n)));
        setAnswer({ kind: "report", report: e.report, results: e.results });
        setPhase("done");
        push("ok", "Report delivered");
        break;
      case "hunt":
        setAnswer({ kind: "hunt", launches: e.launches, opened: e.opened, windowHours: e.windowHours });
        setPhase("done");
        push("ok", "Results are in");
        break;
      case "error":
        setError(e.message);
        setPhase("error");
        break;
    }
  }

  async function run() {
    if (needsToken && !isAddress(token)) return setError("Paste a token address (0x…)");
    if (needsWallet) return connect();
    setError("");
    setAnswer(null);
    setLog([]);
    setNodes(teamNodes(lead.slug));
    paid.current = 0;
    hired.current = new Set();

    try {
      const url = `/api/teams/${lead.slug}`;
      const body = JSON.stringify(needsToken ? { input: token } : {});
      const headers: Record<string, string> = { "content-type": "application/json" };
      let res = await fetch(url, { method: "POST", headers, body });

      if (res.status === 402) {
        // x402: the lead quotes a price; we pay it on-chain and come back with the job id
        const quote = ((await res.json()) as Quote).accepts[0];
        setPhase("paying");
        const jobId = keccak256(toHex(`${lead.slug}-${token}-${Date.now()}-${Math.random()}`));
        const tx = await payFor(how, quote.agentId, quote.maxAmountRequired, jobId, setStep);
        push("pay", `You paid ${lead.name} ${quote.maxAmountRequired} $WIF${how === "eth" ? " (in ETH, swapped for you)" : ""}`, tx);
        res = await fetch(url, { method: "POST", headers: { ...headers, "x-payment": jobId }, body });
      }
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setPhase("running");
      await readEvents<TeamEvent>(res, onEvent);
    } catch (e) {
      setError(errorText(e));
      setPhase("error");
    }
  }

  const busy = phase === "paying" || phase === "running";
  const example = INPUTS.token.example;
  const cta = needsWallet ? "Connect wallet" : phase === "paying" ? "Paying…" : phase === "running" ? "Agents at work…" : needsToken ? `Ask ${lead.name}` : `Send ${lead.name}`;

  return (
    <div className="space-y-5 text-left">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="panel relative p-2"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          {needsToken ? (
            <input
              value={token}
              onChange={(e) => setToken(e.target.value.trim())}
              placeholder="Paste a token address on Robinhood Chain (0x…)"
              aria-label="Token address"
              className="field h-14 flex-1 border-transparent bg-transparent text-base focus:shadow-none"
              spellCheck={false}
            />
          ) : (
            <div className="flex h-14 flex-1 items-center px-4 text-muted">No input needed. {lead.name} reads the chain as it is right now.</div>
          )}
          <button disabled={busy} className="btn btn-primary h-14 px-8">
            {cta}
          </button>
        </div>
        {busy && (
          <div className="pointer-events-none absolute inset-x-6 bottom-0 h-px overflow-hidden">
            <div className="h-px w-1/2 animate-scan bg-accent" />
          </div>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <PriceLine price={price} how={live ? how : undefined} />
        {live && <PayToggle how={how} setHow={setHow} ethOn={ethOn} />}
        {needsToken && example && (
          <button type="button" onClick={() => setToken(example.value)} className="chip hover:border-accent hover:text-accent">
            Try {example.label}
          </button>
        )}
        {step && phase === "paying" && <span className="text-accent">{step}</span>}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      {phase !== "idle" && (
        <div className="grid animate-rise gap-4 lg:grid-cols-[1fr_340px]">
          <div className="panel p-2 sm:p-4">
            <div className="flex items-center justify-between px-2 pb-1 pt-1">
              <span className="chip">
                <span className={`size-1.5 rounded-full ${busy ? "animate-pulse bg-accent" : "bg-ok"}`} /> Live run
              </span>
              {preview && <span className="chip border-warn/60 text-warn">Preview: no money moves</span>}
            </div>
            <TeamGraph lead={lead} nodes={nodes} active={busy} />
          </div>
          <div className="panel flex max-h-[560px] flex-col p-4">
            <div className="chip self-start">Receipts</div>
            <ol className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1 text-sm">
              {log.map((l) => (
                <li key={l.id} className="animate-rise rounded-lg border border-line bg-ink/50 px-3 py-2">
                  <span className="mr-2 inline-block size-1.5 rounded-full align-middle" style={{ background: TONES[l.tone] }} />
                  {l.text}
                  {l.tx && (
                    <a href={txUrl(l.tx)} target="_blank" rel="noreferrer" className="num ml-1 text-xs text-accent hover:underline">
                      tx ↗
                    </a>
                  )}
                </li>
              ))}
              {busy && <li className="px-3 text-xs text-dim">working…</li>}
            </ol>
          </div>
        </div>
      )}

      {answer?.kind === "report" && <ReportCard report={answer.report} results={answer.results} paid={paid.current} agents={hired.current.size} />}
      {answer?.kind === "hunt" && (
        <HuntCard launches={answer.launches} opened={answer.opened} windowHours={answer.windowHours} paid={paid.current} agents={hired.current.size} />
      )}
    </div>
  );
}
