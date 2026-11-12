"use client";

import { useState } from "react";
import type { Report, ServiceResult } from "@/lib/agents/services";
import { SERVICES, type Service } from "@/lib/catalog";
import { addressUrl } from "@/lib/chain";
import type { Hunted } from "@/lib/server/teams";

const TONE = {
  SAFE: { color: "var(--color-ok)", word: "Looks safe" },
  CAUTION: { color: "var(--color-warn)", word: "Be careful" },
  RISKY: { color: "var(--color-danger)", word: "Risky" },
} as const;
/** a clean scan of a token that is minutes old is not "safe", so the hunt uses plainer words */
const HUNT_WORD = { SAFE: "No red flags", CAUTION: "Be careful", RISKY: "Avoid" } as const;
export const DOT = { ok: "var(--color-ok)", info: "var(--color-sky)", warn: "var(--color-warn)", danger: "var(--color-danger)" } as const;

export function scoreColor(s: number) {
  // a new agent with no record sits around 350: unproven, not bad, so it reads highlight rather than red
  return s >= 650 ? "var(--color-ok)" : s >= 300 ? "var(--color-highlight)" : s >= 200 ? "var(--color-warn)" : "var(--color-danger)";
}

export function ScoreRing({ value, color, size = 120, max = 100 }: { value: number; color: string; size?: number; max?: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="-rotate-90">
      <circle cx="50" cy="50" r={r} stroke="var(--color-line)" strokeWidth="6" fill="none" />
      <circle
        cx="50"
        cy="50"
        r={r}
        stroke={color}
        strokeWidth="6"
        fill="none"
        strokeLinecap="butt"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, value / max))}
        style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)" }}
      />
    </svg>
  );
}

function usd(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(1)}k` : `$${n.toFixed(0)}`;
}

/** What one agent delivered: its one-line answer, then each finding. */
export function ResultView({ result }: { result: ServiceResult }) {
  const posts = result.service === "post-writer";
  return (
    <div className="animate-rise">
      <p className="text-lg font-medium leading-snug sm:text-xl">{result.summary}</p>
      <div className={`mt-5 grid gap-2 ${posts ? "" : "sm:grid-cols-2"}`}>
        {result.findings.map((f, i) => (
          <div key={i} className="rounded-lg border border-line bg-ink/55 p-3.5">
            <div className="flex items-start gap-2.5 text-sm font-semibold">
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: DOT[f.level] }} />
              <span className="min-w-0 break-words">{f.title}</span>
            </div>
            <div className={`mt-1 break-words pl-[18px] text-muted ${posts ? "text-[15px] leading-relaxed text-fg" : "text-xs leading-relaxed"}`}>{f.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Guardian's answer: a verdict, a score, the reasons, and each specialist's findings underneath. */
export function ReportCard({ report, results, paid, agents }: { report: Report; results: ServiceResult[]; paid: number; agents: number }) {
  const tone = TONE[report.verdict];
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="panel animate-rise overflow-hidden">
      <div
        className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8"
        style={{ background: `radial-gradient(80% 120% at 0% 0%, color-mix(in oklab, ${tone.color} 13%, transparent), transparent 60%)` }}
      >
        <div className="relative shrink-0 self-center">
          <ScoreRing value={report.score} color={tone.color} size={140} />
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="num text-4xl font-bold">{report.score}</div>
              <div className="cap">of 100</div>
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <div className="chip" style={{ color: tone.color, borderColor: tone.color }}>
            {report.verdict}
          </div>
          <h3 className="display mt-3 text-3xl sm:text-4xl">{tone.word}</h3>
          <p className="mt-2 text-lg text-muted">{report.headline}</p>
          <ul className="mt-4 space-y-2">
            {report.reasons.map((r) => (
              <li key={r} className="flex gap-2.5 text-sm">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: tone.color }} />
                <span className="min-w-0 break-words">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-line">
        {results.map((r) => (
          <div key={r.service} className="border-b border-line last:border-0">
            <button
              onClick={() => setOpen(open === r.service ? null : r.service)}
              className="flex w-full items-center gap-4 px-6 py-3.5 text-left hover:bg-panel-2/60 sm:px-8"
            >
              <span className="cap w-28 shrink-0">{SERVICES[r.service as Service]?.label ?? r.service}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{r.summary}</span>
              <span className="flex shrink-0 gap-1">
                {r.findings.map((f, i) => (
                  <span key={i} className="size-2 rounded-full" style={{ background: DOT[f.level] }} />
                ))}
              </span>
            </button>
            {open === r.service && (
              <div className="grid gap-2 px-6 pb-4 sm:grid-cols-2 sm:px-8">
                {r.findings.map((f, i) => (
                  <div key={i} className="rounded-lg border border-line bg-ink/60 p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: DOT[f.level] }} />
                      {f.title}
                    </div>
                    <div className="mt-1 break-words text-xs text-muted">{f.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <Receipt paid={paid} agents={agents} />
    </div>
  );
}

function Receipt({ paid, agents }: { paid: number; agents: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line bg-ink/40 px-6 py-3 text-xs text-muted sm:px-8">
      <span>
        The work of <b className="text-fg">{agents}</b> agents
      </span>
      <span>
        Paid out <b className="num text-fg">{paid.toLocaleString()}</b> $WIF
      </span>
      <span>
        Burned <b className="num text-fg">{(paid / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> $WIF
      </span>
      <span className="ml-auto">Information, not financial advice.</span>
    </div>
  );
}

/** Scout's answer: the newest launches it had checked, best first. */
export function HuntCard({
  launches,
  opened,
  windowHours,
  paid,
  agents,
}: {
  launches: Hunted[];
  opened: number;
  windowHours: number;
  paid: number;
  agents: number;
}) {
  const window = windowHours < 2 ? `${Math.round(windowHours * 60)} minutes` : `${windowHours.toFixed(1)} hours`;
  return (
    <div className="panel animate-rise overflow-hidden">
      <div className="p-6 sm:p-8">
        <div className="chip border-highlight text-highlight">New launches</div>
        <h3 className="display mt-3 text-2xl sm:text-3xl">
          {opened} pools opened in the last {window}.
        </h3>
        <p className="mt-2 text-lg text-muted">
          {launches.length === 0
            ? "None has real liquidity yet. Nothing worth checking."
            : `These ${launches.length} have the most money in them. Each was scanned and its pool measured. New tokens are the riskiest kind: a clean scan is not a recommendation.`}
        </p>
      </div>
      <div className="border-t border-line">
        {launches.map((l, i) => {
          const tone = { ...TONE[l.verdict], word: HUNT_WORD[l.verdict] };
          return (
            <div key={l.address} className="flex flex-col gap-3 border-b border-line px-6 py-4 last:border-0 sm:flex-row sm:items-center sm:px-8">
              <span className="num w-6 text-sm text-dim">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold">{l.symbol}</span>
                  <span className="chip" style={{ color: tone.color, borderColor: tone.color }}>
                    {tone.word}
                  </span>
                  <span className="text-xs text-muted">
                    {usd(l.liquidityUsd)} liquidity · {l.ageMinutes < 90 ? `${l.ageMinutes} min` : `${Math.round(l.ageMinutes / 60)} h`} old
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  {l.flags.length === 0 ? (
                    <span className="text-ok">No red flags in the code or the pool.</span>
                  ) : (
                    l.flags.map((f) => (
                      <span key={f} className="flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-warn" />
                        {f}
                      </span>
                    ))
                  )}
                </div>
                <a href={addressUrl(l.address)} target="_blank" rel="noreferrer" className="num mt-1.5 block truncate text-[11px] text-dim hover:text-accent">
                  {l.address}
                </a>
              </div>
              <div className="relative shrink-0 self-start sm:self-center">
                <ScoreRing value={l.score} color={tone.color} size={56} />
                <span className="num absolute inset-0 grid place-items-center text-sm font-bold">{l.score}</span>
              </div>
            </div>
          );
        })}
      </div>
      <Receipt paid={paid} agents={agents} />
    </div>
  );
}
