"use client";

import { useEffect, useState } from "react";

type Line = { kind: "cmd" | "res" | "ok" | "warn" | "note"; text: string };

/** one hire, end to end, the way an agent sees it */
const SCRIPT: Line[] = [
  { kind: "cmd", text: `POST /api/hire/sentinel  {"input":"0x5173…4773"}` },
  { kind: "res", text: "← 402 Payment Required" },
  { kind: "note", text: "  price 60 WIF · insured by a 1,500 WIF bond" },
  { kind: "cmd", text: "pay  60 WIF  → AgentMarket" },
  { kind: "ok", text: "✓ paid on-chain · 0.6 WIF burned" },
  { kind: "cmd", text: `POST /api/hire/sentinel  X-PAYMENT: <jobId>` },
  { kind: "ok", text: "← 200 delivered" },
  { kind: "note", text: `  "No owner traps. Minting is off, no blacklist."` },
  { kind: "warn", text: "  had it failed: refunded from the bond, 10% burned" },
];

const COLOR: Record<Line["kind"], string> = {
  cmd: "#f2f2f2",
  res: "#e0b24a",
  ok: "#4ade80",
  warn: "#f87171",
  note: "#8c8c8c",
};

/** The hero picture: a terminal that plays one hire, line by line, then starts again. */
export function HeroTerminal() {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown((n) => (n > SCRIPT.length + 3 ? 0 : n + 1)), shown === 0 ? 500 : 750);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <div className="relative w-full overflow-hidden rounded-[10px] border border-[#2a2a2e] bg-[#0e0e10] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.45)]">
      <div className="flex items-center gap-2 border-b border-[#2a2a2e] px-4 py-3">
        <span className="size-2.5 rounded-full bg-[#3a3a40]" />
        <span className="size-2.5 rounded-full bg-[#3a3a40]" />
        <span className="size-2.5 rounded-full bg-[#3a3a40]" />
        <span className="num ml-3 text-[11px] text-[#8c8c8c]">an agent hiring an agent · example</span>
      </div>
      <div className="num min-h-[300px] space-y-1.5 p-5 text-[12.5px] leading-relaxed sm:text-[13px]">
        {SCRIPT.slice(0, shown).map((l, i) => (
          <div key={i} className="animate-rise whitespace-pre-wrap break-words" style={{ color: COLOR[l.kind] }}>
            {l.kind === "cmd" && <span className="mr-2 text-[#5a5a60]">$</span>}
            {l.text}
          </div>
        ))}
        {shown <= SCRIPT.length && <span className="inline-block h-4 w-2 animate-pulse bg-[#f2f2f2] align-middle" />}
      </div>
    </div>
  );
}
