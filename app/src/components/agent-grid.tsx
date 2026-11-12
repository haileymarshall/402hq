"use client";

import Link from "next/link";
import { useState } from "react";
import { CATEGORIES, SERVICES, type Category, type Service } from "@/lib/catalog";
import { agentName, type AgentView } from "@/lib/market";
import { dollars, fmt, useMarket } from "@/lib/use-market";
import { AgentAvatar, toneFor } from "./agent-avatar";
import { ScoreRing, scoreColor } from "./result-view";

const ORDER: Category[] = ["teams", "safety", "market", "wallets", "writing"];

/** where an agent's page lives: our own by name, anyone else's by on-chain id */
export const agentHref = (a: AgentView) => `/agents/${a.profile?.slug ?? a.id}`;

export function AgentCard({ a, wifUsd }: { a: AgentView; wifUsd?: number }) {
  const name = agentName(a);
  const p = a.profile;
  const usd = dollars(a.price, wifUsd);
  return (
    <Link
      href={agentHref(a)}
      className="panel group flex flex-col p-5 transition duration-300 hover:border-line-2 hover:bg-panel-2"
    >
      <div className="flex items-start gap-4">
        <AgentAvatar slug={p?.slug} tone={toneFor(p)} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold leading-tight">{name}</h3>
            {!a.active && <span className="chip border-danger/50 text-danger">paused</span>}
          </div>
          <div className="mt-0.5 truncate text-sm text-muted">{SERVICES[a.service as Service]?.label ?? a.service}{p ? "" : " · listed by its builder"}</div>
        </div>
        <div className="relative shrink-0" title={`Trust score ${a.score} of 1,000`}>
          <ScoreRing value={a.score} max={1000} color={scoreColor(a.score)} size={44} />
          <span className="num absolute inset-0 grid place-items-center text-[10px] font-bold">{a.score}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {p?.team && <span className="chip border-highlight/60 text-highlight">Hires other agents</span>}
        {p?.trickster && <span className="chip border-danger/60 text-danger">Fails on purpose</span>}
      </div>

      <p className="mt-3 flex-1 text-sm leading-relaxed text-fg/85">{p?.job ?? a.endpoint}</p>
      {p && (
        <p className="mt-3 text-xs text-muted">
          <span className="cap mr-1.5">Hired by</span>
          {p.buyers}
        </p>
      )}

      <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
        <div>
          <div className="num text-xl font-semibold leading-none">
            {fmt(a.price)} <span className="text-sm font-normal text-muted">$WIF</span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {usd ? `about ${usd} a job` : "per job"} · {a.jobsDone} done{a.jobsFailed > 0 && <span className="text-danger"> · {a.jobsFailed} failed</span>}
          </div>
        </div>
        <span className="text-sm font-medium text-accent transition group-hover:translate-x-0.5">Hire →</span>
      </div>
    </Link>
  );
}

/** Every agent for hire, filtered by the kind of work. */
export function AgentGrid() {
  const { data, isLoading } = useMarket();
  const [filter, setFilter] = useState<Category | "all">("all");
  const agents = data?.agents ?? [];
  const mine = (c: Category) => agents.filter((a) => a.profile?.category === c);
  const others = agents.filter((a) => !a.profile);
  const shown =
    filter === "all"
      ? [...ORDER.flatMap(mine), ...others]
      : mine(filter);

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Kind of work">
        {(["all", ...ORDER] as const).map((c) => {
          const on = filter === c;
          const count = c === "all" ? agents.length : mine(c).length;
          return (
            <button
              key={c}
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(c)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${on ? "border-accent bg-accent text-ink" : "border-line-2 text-muted hover:text-fg"}`}
            >
              {c === "all" ? "All agents" : CATEGORIES[c].label}
              <span className={`num ml-2 ${on ? "opacity-70" : "opacity-60"}`}>{count}</span>
            </button>
          );
        })}
      </div>
      {filter !== "all" && <p className="mt-3 text-sm text-muted">{CATEGORIES[filter].blurb}.</p>}

      {isLoading ? (
        <div className="panel mt-6 p-10 text-center text-sm text-muted">Reading the market…</div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => (
            <AgentCard key={a.id} a={a} wifUsd={data?.rates.wifUsd} />
          ))}
        </div>
      )}
      {data && !data.live && (
        <p className="mt-4 text-xs text-muted">Preview: the market contract isn’t deployed yet, so scores and records start blank and no money moves.</p>
      )}
    </div>
  );
}
