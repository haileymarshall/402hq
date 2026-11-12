/** the house mark: API brackets around a coin, an endpoint you pay per call (HTTP 402) */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[22%] bg-fg text-ink" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[64%]">
        <path d="M8 4H5v16h3M16 4h3v16h-3" />
        <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

export function Wordmark() {
  return (
    <span className="font-display text-[17px] font-semibold tracking-tight">402HQ</span>
  );
}

/** a small flame, for the burn counter */
export function Flame({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.500c1 3.500 5.500 5.500 5.500 11a5.500 5.500 0 0 1-11 0c0-2 .800-3.300 1.800-4.500.500 1.500 1.200 2.200 2 2.500-.300-3.500.700-6.500 1.700-9z" />
    </svg>
  );
}
