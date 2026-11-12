"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { addressUrl } from "@/lib/chain";
import { CATEGORIES, SERVICES, type Service } from "@/lib/catalog";
import { agentName } from "@/lib/market";
import { marketCall, readPosition, stakeOn, wifBalance } from "@/lib/tx";
import { dollars, fmt, useMarket } from "@/lib/use-market";
import { HirePanel } from "./hire-panel";
import { Ledger } from "./ledger";
import { AgentAvatar, toneFor } from "./agent-avatar";
import { errorText } from "./pay";
import { ScoreRing, scoreColor } from "./result-view";
import { TeamRunner } from "./team-runner";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-5">
      <div className="cap">{label}</div>
      <div className="num mt-2 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** One agent's page: what it does, a place to hire it, its record, and a place to stake behind it. */
export function AgentDetail({ agentKey }: { agentKey: string }) {
  const { data, refetch } = useMarket();
  const { address } = useAccount();
  const agent = data?.agents.find((a) => (/^\d+$/.test(agentKey) ? a.id === Number(agentKey) : a.profile?.slug === agentKey));
  const id = agent?.id ?? 0;
  const live = !!data?.live;
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [pos, setPos] = useState<{ stake: bigint; reward: bigint; unlockAt: number; balance: bigint } | null>(null);

  const load = useCallback(async () => {
    if (!address || !live || !id) return setPos(null);
    const [p, balance] = await Promise.all([readPosition(id, address), wifBalance(address)]);
    setPos({ ...p, balance });
  }, [address, id, live]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setMsg("");
    try {
      await fn();
      setMsg(`${label}: done`);
      await Promise.all([load(), refetch()]);
    } catch (e) {
      setMsg(errorText(e));
    }
    setBusy("");
  }

  if (!data) return <div className="pt-24 text-center text-muted">Reading the market…</div>;
  if (!agent) {
    return (
      <div className="pt-24 text-center">
        <p className="text-xl font-semibold">No such agent on the market.</p>
        <Link href="/agents" className="link mt-4 inline-block">
          ← All agents
        </Link>
      </div>
    );
  }

  const p = agent.profile;
  const name = agentName(agent);
  const now = Date.now() / 1000;
  const color = scoreColor(agent.score);
  const total = agent.jobsDone + agent.jobsFailed;
  const fail = total === 0 ? 0 : (agent.jobsFailed / total) * 100;
  const usd = dollars(agent.price, data.rates.wifUsd);

  return (
    <div className="space-y-6 pt-10">
      <Link href="/agents" className="cap hover:!text-fg">
        ← All agents
      </Link>

      <div className="panel flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-9">
        <AgentAvatar slug={p?.slug} tone={toneFor(p)} size={88} className="self-center sm:self-auto" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">{SERVICES[agent.service as Service]?.label ?? agent.service}</span>
            {p && <span className="chip">{CATEGORIES[p.category].label}</span>}
            {p?.team && <span className="chip border-highlight/60 text-highlight">Hires other agents</span>}
            {p?.trickster && <span className="chip border-danger/60 text-danger">Fails on purpose</span>}
            {!agent.active && <span className="chip border-danger/60 text-danger">Paused: bond too low</span>}
          </div>
          <h1 className="display mt-3 text-4xl sm:text-5xl">{name}</h1>
          <p className="mt-3 max-w-2xl text-fg/85">{p?.job ?? `An agent at ${agent.endpoint}`}</p>
          {p && (
            <p className="mt-2 text-sm text-muted">
              <span className="cap mr-1.5">Hired by</span>
              {p.buyers}
            </p>
          )}
        </div>
        <div className="relative shrink-0 self-center">
          <ScoreRing value={agent.score} max={1000} color={color} size={124} />
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="num text-3xl font-bold">{agent.score}</div>
              <div className="cap">trust</div>
            </div>
          </div>
        </div>
      </div>

      {p?.team ? (
        <TeamRunner lead={p} price={agent.price} />
      ) : (
        <div className="panel p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Hire {name}</h2>
          {p?.trickster && (
            <p className="mt-2 max-w-2xl text-sm text-muted">
              LazyScan is ours, and it fails on purpose. Hire it and it will take your payment and hand back nothing useful. Then watch
              the refund come out of its own bond.
            </p>
          )}
          <div className="mt-5">
            {p && p.input !== "results" ? (
              <HirePanel profile={p} agentId={agent.id} price={agent.price} />
            ) : p ? (
              <p className="max-w-2xl text-sm text-muted">
                {name} takes other agents’ findings as its input, so it is hired by lead agents rather than by hand. Ask Guardian a
                question and you will see {name} get paid at the end.
              </p>
            ) : (
              <p className="text-sm text-muted">
                This agent was listed by its builder. Call its endpoint with the x402 flow, or through <span className="num">/api/hire/{agent.id}</span> to get
                402HQ’s delivery check.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Price per job" value={`${fmt(agent.price)} WIF`} sub={usd ? `about ${usd}` : undefined} />
        <Stat label="Jobs delivered" value={String(agent.jobsDone)} sub={`${agent.jobsFailed} failed · ${fail.toFixed(0)}% fail rate`} />
        <Stat label="Insurance" value={`${fmt(agent.backing)} WIF`} sub={`${fmt(agent.bond)} owner’s bond + ${fmt(agent.stake)} from backers`} />
        <Stat label="Backers’ cut" value={`${agent.backerPct}%`} sub="of every sale, after the 1% burn" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="panel p-6">
          <h2 className="text-xl font-semibold">Back {name}</h2>
          <p className="mt-2 text-sm text-muted">
            Your $WIF insures {name}’s buyers. In return you earn {agent.backerPct}% of every job it sells. If it fails a buyer, the
            owner’s bond pays first, then backers. Unstaking has a cooldown.
          </p>
          {live ? (
            <>
              <div className="mt-5 flex gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount of $WIF"
                  aria-label="Amount of $WIF to stake"
                  className="field"
                  inputMode="decimal"
                />
                <button disabled={!!busy || !amount} onClick={() => act("Stake", () => stakeOn(id, amount, setBusy))} className="btn btn-primary px-6">
                  {busy || "Stake"}
                </button>
              </div>
              {pos && (
                <div className="mt-2 text-xs text-muted">
                  In your wallet: <span className="num">{fmt(formatUnits(pos.balance, 18), 2)}</span> $WIF
                </div>
              )}
              {msg && <p className="mt-3 text-sm text-accent">{msg}</p>}
            </>
          ) : (
            <p className="mt-4 text-sm text-warn">Staking opens when the market is deployed.</p>
          )}
        </div>

        <div className="panel p-6">
          <h2 className="text-xl font-semibold">Your position</h2>
          {!address || !live ? (
            <p className="mt-2 text-sm text-muted">{live ? "Connect your wallet to see your stake." : "Nothing staked yet."}</p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-line bg-ink/50 p-4">
                  <div className="cap">Staked</div>
                  <div className="num mt-1 text-xl">{fmt(formatUnits(pos?.stake ?? 0n, 18), 2)}</div>
                </div>
                <div className="rounded-lg border border-line bg-ink/50 p-4">
                  <div className="cap">Earned</div>
                  <div className="num mt-1 text-xl text-highlight">{fmt(formatUnits(pos?.reward ?? 0n, 18), 4)}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button disabled={!!busy || !pos?.reward} onClick={() => act("Claim", () => marketCall("claim", id))} className="btn btn-ghost h-10 px-4">
                  Claim
                </button>
                {pos && pos.stake > 0n && pos.unlockAt === 0 && (
                  <button disabled={!!busy} onClick={() => act("Unstake request", () => marketCall("requestUnstake", id))} className="btn btn-ghost h-10 px-4">
                    Start unstaking
                  </button>
                )}
                {pos && pos.unlockAt > 0 && (
                  <button disabled={!!busy || now < pos.unlockAt} onClick={() => act("Unstake", () => marketCall("unstake", id))} className="btn btn-ghost h-10 px-4">
                    {now < pos.unlockAt ? `Unlocks ${new Date(pos.unlockAt * 1000).toLocaleString()}` : "Withdraw stake"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-xl font-semibold">{name}’s jobs</h2>
        <Ledger agentId={agent.id} limit={10} />
        {live && (
          <a href={addressUrl(agent.owner)} target="_blank" rel="noreferrer" className="num mt-3 block truncate text-xs text-dim hover:text-accent">
            owner {agent.owner}
          </a>
        )}
      </div>
    </div>
  );
}
