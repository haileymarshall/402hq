"use client";

import { useState } from "react";
import { PROFILES, SERVICES, TEAM_SERVICES } from "@/lib/catalog";
import { useMarket } from "@/lib/use-market";
import { AgentAvatar } from "./agent-avatar";
import { TeamRunner } from "./team-runner";

const LEADS = PROFILES.filter((p) => p.team);

/** The two lead agents, side by side: pick one, give it the job, watch it hire. */
export function Teams() {
  const [slug, setSlug] = useState(LEADS[0].slug);
  const { data } = useMarket();
  const lead = LEADS.find((l) => l.slug === slug)!;
  const price = data?.agents.find((a) => a.profile?.slug === slug)?.price ?? String(lead.price);
  const buys = (TEAM_SERVICES[slug] ?? []).map((s) => SERVICES[s].label.toLowerCase());

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2" role="tablist" aria-label="Lead agent">
        {LEADS.map((l) => {
          const on = l.slug === slug;
          return (
            <button
              key={l.slug}
              role="tab"
              aria-selected={on}
              onClick={() => setSlug(l.slug)}
              className={`panel flex items-center gap-4 p-4 text-left transition ${on ? "border-highlight/60 bg-panel-2" : "opacity-70 hover:opacity-100"}`}
            >
              <AgentAvatar slug={l.slug} tone={on ? "lead" : "muted"} size={52} className="shrink-0" />
              <div className="min-w-0">
                <div className="text-lg font-semibold leading-none">{l.name}</div>
                <div className="mt-1 text-xs text-muted">{SERVICES[l.service].label}</div>
                <div className="mt-1.5 text-sm text-fg/85">{l.slug === "guardian" ? "“Is this token safe to buy?”" : "“What just launched, and is any of it real?”"}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <p className="mb-4 max-w-3xl text-sm text-muted">
          {lead.job} It buys: {buys.join(", ")}.
        </p>
        {/* a fresh runner per lead, so one team's run never bleeds into the other's */}
        <TeamRunner key={lead.slug} lead={lead} price={price} />
      </div>
    </div>
  );
}
