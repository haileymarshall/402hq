import type { ReactNode } from "react";

/** Each agent's icon on a 24×24 grid, keyed by the agent's slug. */
const ICONS: Record<string, ReactNode> = {
  guardian: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z" />
      <path d="m8.8 12 2.2 2.2 4.4-4.4" />
    </>
  ),
  scout: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  sentinel: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M7 12h10" />
    </>
  ),
  lazyscan: (
    <>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </>
  ),
  census: (
    <>
      <path d="M11 4a8.5 8.5 0 1 0 9 9h-9z" />
      <path d="M14 3.2A8.5 8.5 0 0 1 20.8 10H14z" />
    </>
  ),
  depth: <path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3z" />,
  origin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  ticker: (
    <>
      <path d="m3 17 5-5 4 3 8-8" />
      <path d="M15 7h5v5" />
    </>
  ),
  whalewatch: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12 18.4 5.6" />
    </>
  ),
  xray: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M16 14.5h2" />
    </>
  ),
  decoder: <path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5" />,
  scribe: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  blueprint: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />,
  herald: (
    <>
      <path d="M4 10h3.5L16 5v14l-8.5-5H4z" />
      <path d="M19 9.3a4.5 4.5 0 0 1 0 5.4M7.5 14v4.5" />
    </>
  ),
  hq: (
    <>
      <circle cx="6" cy="6.5" r="2.5" />
      <circle cx="18" cy="6.5" r="2.5" />
      <circle cx="12" cy="17.5" r="2.5" />
      <path d="M8.5 6.5h7M7.2 8.7l3.6 6.6M16.8 8.7l-3.6 6.6" />
    </>
  ),
  unknown: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2.5" />
      <path d="M12 4.5V8M9.5 13v.5M14.5 13v.5" />
    </>
  ),
};

export type Tone = "accent" | "lead" | "warn" | "muted";
const TONES: Record<Tone, string> = {
  accent: "bg-accent/12 text-accent border-accent/25",
  lead: "bg-highlight/12 text-highlight border-highlight/30",
  warn: "bg-danger/12 text-danger border-danger/25",
  muted: "bg-panel-2 text-dim border-line-2",
};

/** An agent's avatar: a rounded tile with its icon. */
export function AgentAvatar({
  slug,
  tone = "accent",
  size = 48,
  className = "",
}: {
  slug?: string;
  tone?: Tone;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-[28%] border ${TONES[tone]} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-1/2">
        {ICONS[slug ?? "unknown"] ?? ICONS.unknown}
      </svg>
    </div>
  );
}

export const toneFor = (p: { team?: boolean; trickster?: boolean } | undefined): Tone => (p?.team ? "lead" : p?.trickster ? "warn" : "accent");
