"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { MarketSnapshot } from "./server/feed";

export type MarketData = MarketSnapshot;

const never = () => () => {};
/** false on the server and while the page hydrates, true from then on */
export const useHydrated = () => useSyncExternalStore(never, () => true, () => false);

export function useMarket() {
  const q = useQuery({
    queryKey: ["market"],
    queryFn: async (): Promise<MarketData> => (await fetch("/api/market")).json(),
    refetchInterval: 8_000,
  });
  // Parts of a page hydrate at different moments. One that hydrates late would find the market already loaded and
  // render something the server never sent, so every part starts from "loading", exactly as the server drew it.
  const hydrated = useHydrated();
  return { data: hydrated ? q.data : undefined, isLoading: hydrated ? q.isLoading : true, refetch: q.refetch };
}

export const fmt = (v: string | number, digits = 0) =>
  Number(v).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** 12500 → 12.5k */
export function compact(v: string | number) {
  const n = Number(v);
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return fmt(n, n < 100 ? 2 : 0);
}

/** a $WIF amount in dollars, for people who don't think in $WIF */
export function dollars(wif: string | number, wifUsd: number | undefined) {
  if (!wifUsd) return null;
  const v = Number(wif) * wifUsd;
  return v < 0.01 ? "<$0.01" : v < 10 ? `$${v.toFixed(2)}` : `$${fmt(v)}`;
}

export function timeAgo(seconds: number) {
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
