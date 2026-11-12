"use client";

import Link from "next/link";
import { SERVICES, type Service } from "@/lib/catalog";
import { agentName } from "@/lib/market";
import { compact, dollars, fmt, useMarket } from "@/lib/use-market";
import { AgentAvatar, toneFor } from "./agent-avatar";
import { agentHref } from "./agent-grid";
import { scoreColor } from "./result-view";

/** The market as a table: the agents with the best record first. */
export function AgentTable({ limit = 6 }: { limit?: number }) {
  const { data, isLoading } = useMarket();
  const agents = (data?.agents ?? []).slice(0, limit);
  const cols = "grid-cols-[1fr_auto_28px] sm:grid-cols-[1.6fr_1fr_110px_120px_90px_28px]";

  return (
    <div className="panel overflow-hidden text-left">
      <div className={`grid ${cols} items-center gap-4 border-b border-line bg-panel-2 px-4 py-2.5`}>
        <span className="cap">Agent</span>
        <span className="cap hidden sm:block">Job</span>
        <span className="cap text-right">Price</span>
        <span className="cap hidden text-right sm:block">Insured by</span>
        <span className="cap hidden text-right sm:block">Trust</span>
        <span />
      </div>
      {isLoading && <div className="p-8 text-center text-sm text-muted">Reading the market…</div>}
      {agents.map((a) => {
        const usd = dollars(a.price, data?.rates.wifUsd);
        return (
          <Link
            key={a.id}
            href={agentHref(a)}
            className={`group grid ${cols} items-center gap-4 border-b border-line px-4 py-3 transition last:border-0 hover:bg-panel-2`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <AgentAvatar slug={a.profile?.slug} tone={toneFor(a.profile)} size={32} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{agentName(a)}</span>
                <span className="block truncate text-xs text-dim">{SERVICES[a.service as Service]?.label ?? a.service}</span>
              </span>
            </span>
            <span className="hidden truncate text-sm text-muted sm:block">{a.profile?.job ?? a.endpoint}</span>
            <span className="text-right">
              <span className="num block text-sm">{fmt(a.price)} WIF</span>
              {usd && <span className="num block text-[11px] text-dim">{usd}</span>}
            </span>
            <span className="num hidden text-right text-sm text-muted sm:block">{compact(a.backing)} WIF</span>
            <span className="hidden justify-end sm:flex">
              <span className="num inline-flex items-center gap-1.5 rounded-[4px] bg-panel-2 px-2 py-0.5 text-xs">
                <span className="size-1.5 rounded-full" style={{ background: scoreColor(a.score) }} />
                {a.score}
              </span>
            </span>
            <span className="text-right text-dim transition group-hover:translate-x-0.5 group-hover:text-fg">→</span>
          </Link>
        );
      })}
    </div>
  );
}
