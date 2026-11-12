import type { Address } from "viem";

/** One trading pool as DexScreener reports it. */
export type DexPair = {
  chainId: string;
  dexId: string;
  labels?: string[];
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative?: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number; m5?: number };
  txns?: { h24?: { buys: number; sells: number }; h1?: { buys: number; sells: number } };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
};

const CHAIN = "robinhood";

/** Every pool for up to 30 tokens per request, in parallel. Tokens with no pool simply don't appear. */
export async function pairsFor(tokens: Address[]): Promise<DexPair[]> {
  const batches: Address[][] = [];
  for (let i = 0; i < tokens.length; i += 30) batches.push(tokens.slice(i, i + 30));
  const out = await Promise.all(
    batches.map(async (b) => {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/${CHAIN}/${b.join(",")}`, { cache: "no-store" });
      if (!res.ok) return [] as DexPair[];
      const body = (await res.json()) as DexPair[] | null;
      return Array.isArray(body) ? body : [];
    }),
  );
  return out.flat().filter((p) => p.chainId === CHAIN);
}

/** the deepest pool where `token` is the token being priced */
export function mainPair(pairs: DexPair[], token: string) {
  const mine = pairs.filter((p) => p.baseToken.address.toLowerCase() === token.toLowerCase());
  if (mine.length === 0) return null;
  return mine.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
}

export const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(1)}k` : n >= 1 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;

export const price = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(4)}`);

export const pct = (n: number | undefined) => (n === undefined ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`);

/** 1234567 → 1.23M */
export function compact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (a >= 1) return n.toFixed(a >= 100 ? 0 : 2);
  return n.toPrecision(3);
}
