"use client";

import { AgentAvatar, toneFor } from "./agent-avatar";
import { PROFILES, SERVICES, TEAM_SERVICES, type Profile } from "@/lib/catalog";

export type NodeState = "idle" | "skipped" | "considering" | "paid" | "delivered" | "failed" | "refunded";
export type GraphNode = { slug?: string; name: string; label: string; state: NodeState; jobs: number; profile?: Profile };

const COLOR: Record<NodeState, string> = {
  idle: "var(--color-line-2)",
  skipped: "var(--color-dim)",
  considering: "var(--color-sky)",
  paid: "var(--color-accent)",
  delivered: "var(--color-ok)",
  failed: "var(--color-danger)",
  refunded: "var(--color-warn)",
};
const LABEL: Record<NodeState, string> = {
  idle: "waiting",
  skipped: "passed over",
  considering: "checking rules",
  paid: "paid · working",
  delivered: "delivered",
  failed: "failed",
  refunded: "refunded",
};

/** the agents a lead can hire, as idle nodes */
export function teamNodes(team: string): GraphNode[] {
  const wanted = TEAM_SERVICES[team] ?? [];
  return PROFILES.filter((p) => wanted.includes(p.service)).map((p) => ({
    slug: p.slug,
    name: p.name,
    label: SERVICES[p.service].label,
    state: "idle",
    jobs: 0,
    profile: p,
  }));
}

/**
 * The lead agent in the middle and the agents it can hire around it. Lines light up as the lead checks, pays and
 * hears back from each one; a dot travels out on payment and back on a refund.
 */
export function TeamGraph({ lead, nodes, active }: { lead: Profile; nodes: GraphNode[]; active: boolean }) {
  const W = 1000;
  const H = 520;
  const cx = W / 2;
  const cy = H / 2;
  const pos = nodes.map((_, i) => {
    const a = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2 + Math.PI / nodes.length;
    return { x: cx + Math.cos(a) * 380, y: cy + Math.sin(a) * 190 };
  });

  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full">
        {nodes.map((n, i) => {
          const p = pos[i];
          const lit = n.state !== "idle" && n.state !== "skipped";
          const path = `M${cx},${cy} L${p.x},${p.y}`;
          const moving = n.state === "considering" || n.state === "paid";
          return (
            <g key={n.name}>
              <path
                d={path}
                stroke={COLOR[n.state]}
                strokeWidth={lit ? 2 : 1}
                strokeOpacity={lit ? 0.9 : 0.5}
                strokeDasharray={moving ? "6 6" : undefined}
                className={moving ? "animate-dash" : undefined}
                fill="none"
              />
              {(n.state === "paid" || n.state === "refunded") && (
                <circle r="7" fill={COLOR[n.state]}>
                  <animateMotion
                    dur="1.1s"
                    repeatCount={n.state === "paid" ? "indefinite" : "1"}
                    path={path}
                    keyPoints={n.state === "refunded" ? "1;0" : "0;1"}
                    keyTimes="0;1"
                    calcMode="linear"
                    fill="freeze"
                  />
                </circle>
              )}
            </g>
          );
        })}
      </svg>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
        <div className={`mx-auto w-fit rounded-[28%] ${active ? "animate-pulse-ring" : ""}`} style={{ ["--ring" as string]: "var(--color-highlight)" }}>
          <AgentAvatar slug={lead.slug} tone="lead" size={76} className="size-[52px] sm:size-[76px]" />
        </div>
        <div className="mt-1.5 text-sm font-semibold sm:text-base">{lead.name}</div>
      </div>

      {nodes.map((n, i) => {
        const p = pos[i];
        const dim = n.state === "idle" || n.state === "skipped";
        return (
          <div
            key={n.name}
            className="absolute w-[20%] min-w-0 -translate-x-1/2 -translate-y-1/2 text-center"
            style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
          >
            <div
              className="relative mx-auto w-fit rounded-[28%] transition-all duration-300"
              style={{
                boxShadow: dim ? undefined : `0 0 0 2px ${COLOR[n.state]}`,
                opacity: n.state === "skipped" ? 0.4 : 1,
              }}
            >
              <AgentAvatar slug={n.slug} tone={dim ? "muted" : toneFor(n.profile)} size={46} className="size-8 sm:size-[46px]" />
              {n.jobs > 1 && (
                <span className="num absolute -right-2 -top-1 rounded-full border border-ink bg-fg px-1.5 text-[10px] font-bold text-ink">×{n.jobs}</span>
              )}
            </div>
            <div className="mt-1 truncate text-xs font-semibold sm:text-sm">{n.name}</div>
            <div className="hidden truncate text-[11px] text-muted sm:block">{n.label}</div>
            <div className="truncate text-[9px] font-medium sm:text-[11px]" style={{ color: COLOR[n.state] }}>
              {LABEL[n.state]}
            </div>
          </div>
        );
      })}
    </div>
  );
}
