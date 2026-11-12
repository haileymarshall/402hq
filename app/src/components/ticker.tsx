"use client";

import { SERVICES, type Service } from "@/lib/catalog";
import { agentName } from "@/lib/market";
import { compact, fmt, useMarket } from "@/lib/use-market";

/** A strip of live market data that scrolls under the header. */
export function Ticker() {
  const { data } = useMarket();
  const agents = data?.agents ?? [];
  if (agents.length === 0) return <div className="h-9 border-b border-line bg-fg" />;

  const items = [
    ...agents.map((a) => (
      <span key={a.id} className="flex shrink-0 items-center gap-2.5 px-6">
        <span className="font-semibold text-ink">{agentName(a)}</span>
        <span className="text-ink/50">{SERVICES[a.service as Service]?.label ?? a.service}</span>
        <span className="text-ink">{fmt(a.price)} WIF</span>
        <span className="text-ink/50">trust {a.score}</span>
      </span>
    )),
    <span key="burned" className="flex shrink-0 items-center gap-2.5 px-6">
      <span className="font-semibold text-ink">$WIF burned</span>
      <span className="text-ink">{compact(data?.totals.burned ?? 0)}</span>
    </span>,
  ];

  return (
    <div className="group relative h-9 overflow-hidden border-b border-line bg-fg" aria-label="Live agent prices">
      <div className="num flex h-full w-max animate-marquee items-center text-[12px] group-hover:[animation-play-state:paused]">
        {/* two copies, so the loop is seamless */}
        <div className="flex items-center divide-x divide-ink/15">{items}</div>
        <div className="flex items-center divide-x divide-ink/15" aria-hidden>
          {items}
        </div>
      </div>
    </div>
  );
}
