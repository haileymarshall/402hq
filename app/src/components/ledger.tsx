"use client";

import { addressUrl, txUrl } from "@/lib/chain";
import type { FeedItem } from "@/lib/market";
import { compact, fmt, timeAgo, useMarket } from "@/lib/use-market";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Row({ f }: { f: FeedItem }) {
  const refund = f.kind === "refunded";
  return (
    <a
      href={txUrl(f.tx)}
      target="_blank"
      rel="noreferrer"
      className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 transition last:border-0 hover:bg-panel-2/60 sm:grid-cols-[84px_1fr_110px_90px_28px]"
    >
      <span className="num hidden text-xs text-dim sm:block">{timeAgo(f.ago)}</span>
      <span className="min-w-0 truncate text-sm">
        <span className={`mr-2 inline-block size-1.5 rounded-full align-middle ${refund ? "bg-warn" : "bg-accent"}`} />
        {refund ? (
          <>
            <b className="font-semibold">{f.agent}</b> failed and repaid{" "}
            <span className={f.buyerName ? "font-semibold" : "num text-muted"}>{f.buyerName ?? short(f.buyer)}</span>
          </>
        ) : (
          <>
            <span className={f.buyerName ? "font-semibold text-highlight" : "num text-muted"}>{f.buyerName ?? short(f.buyer)}</span> hired{" "}
            <b className="font-semibold">{f.agent}</b>
            {f.buyerName && <span className="chip ml-2 border-highlight/50 !py-0 text-highlight">agent to agent</span>}
          </>
        )}
      </span>
      <span className={`num text-right text-sm ${refund ? "text-warn" : ""}`}>
        {refund ? "+" : ""}
        {fmt(f.amount, 2)} <span className="text-xs text-muted">WIF</span>
      </span>
      <span className="num hidden text-right text-xs text-muted sm:block" title="Burned">
        {fmt(f.burned, 2)} burned
      </span>
      <span className="hidden text-right text-xs text-accent sm:block">↗</span>
    </a>
  );
}

/** The public ledger: every paid job and every refund, straight from the market contract's events. */
export function Ledger({ limit = 12, agentId }: { limit?: number; agentId?: number }) {
  const { data, isLoading } = useMarket();
  const items = (data?.feed ?? []).filter((f) => agentId === undefined || f.agentId === agentId).slice(0, limit);
  return (
    <div className="panel overflow-hidden">
      <div className="hidden grid-cols-[84px_1fr_110px_90px_28px] gap-4 border-b border-line px-5 py-3 sm:grid">
        <span className="cap">When</span>
        <span className="cap">What happened</span>
        <span className="cap text-right">Paid</span>
        <span className="cap text-right">Burned</span>
        <span />
      </div>
      {isLoading && <div className="p-8 text-center text-sm text-muted">Reading the chain…</div>}
      {items.map((f) => (
        <Row key={`${f.kind}-${f.jobId}`} f={f} />
      ))}
      {!isLoading && items.length === 0 && (
        <div className="p-8 text-center text-sm text-muted">
          {data?.live
            ? agentId === undefined
              ? "No jobs yet. The first one you pay for will show here within seconds."
              : "No jobs yet for this agent."
            : "The market isn’t deployed yet. Once it is, every paid job and refund is listed here with its transaction."}
        </div>
      )}
    </div>
  );
}

/** Four numbers that say whether the market is alive. All read from the chain. */
export function Stats() {
  const { data } = useMarket();
  const t = data?.totals;
  const items = [
    { label: "Agents for hire", value: t ? String(t.agents) : "…" },
    { label: "Jobs paid for", value: t ? fmt(t.jobs) : "…" },
    { label: "$WIF burned", value: t ? compact(t.burned) : "…" },
    { label: "$WIF insuring buyers", value: t ? compact(t.insured) : "…", note: data && !data.live ? "planned, not yet locked" : undefined },
  ];
  return (
    <div className="panel grid grid-cols-2 lg:grid-cols-4">
      {items.map((s, i) => (
        <div key={s.label} className={`px-6 py-6 ${i % 2 === 1 ? "border-l border-line" : ""} ${i > 1 ? "border-t border-line lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}>
          <div className="num text-3xl font-semibold leading-none sm:text-4xl">{s.value}</div>
          <div className="cap mt-2.5">{s.label}</div>
          {s.note && <div className="mt-1 text-[11px] text-warn">{s.note}</div>}
        </div>
      ))}
    </div>
  );
}

export { addressUrl };
