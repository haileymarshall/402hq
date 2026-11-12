import { erc20Abi, getAddress, parseAbiItem, type Address, type Hex, type Log } from "viem";
import { publicClient, logsClient } from "../chain";

export const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
export type TransferLog = Log<bigint, number, false, typeof transferEvent>;

const MAX_SPAN = 10_000_000n; // the RPC's getLogs block limit
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = new Set([ZERO, "0x000000000000000000000000000000000000dead"]);

/** Robinhood Chain makes a block roughly every 0.1 seconds */
export const SECONDS_PER_BLOCK = 0.1025;
export const blocksToHours = (blocks: bigint | number) => (Number(blocks) * SECONDS_PER_BLOCK) / 3600;

export function ago(seconds: number) {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}

export async function tokenBasics(token: Address) {
  const [name, symbol, decimals, totalSupply] = await publicClient.multicall({
    contracts: [
      { address: token, abi: erc20Abi, functionName: "name" },
      { address: token, abi: erc20Abi, functionName: "symbol" },
      { address: token, abi: erc20Abi, functionName: "decimals" },
      { address: token, abi: erc20Abi, functionName: "totalSupply" },
    ],
  });
  if (totalSupply.status !== "success") {
    // tell "this is not a token" (the buyer's mistake) apart from "the chain didn't answer" (ours)
    const code = await publicClient.getCode({ address: token });
    if (code && code !== "0x" && [name, symbol, decimals].every((r) => r.status !== "success")) {
      const again = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }).catch(() => null);
      if (again === null) throw new Error("not an ERC-20 token on Robinhood Chain");
      throw new Error("the chain was too busy to read this token; try again");
    }
    throw new Error("not an ERC-20 token on Robinhood Chain");
  }
  return {
    name: name.result ?? "unknown",
    symbol: symbol.result ?? "?",
    decimals: decimals.result ?? 18,
    totalSupply: totalSupply.result,
  };
}

/** symbol and decimals for many tokens in one call; tokens that don't answer are left out */
export async function tokenMeta(tokens: Address[]) {
  const res = await publicClient.multicall({
    contracts: tokens.flatMap((address) => [
      { address, abi: erc20Abi, functionName: "symbol" as const },
      { address, abi: erc20Abi, functionName: "decimals" as const },
    ]),
  });
  const out = new Map<string, { symbol: string; decimals: number }>();
  tokens.forEach((t, i) => {
    const symbol = res[i * 2];
    const decimals = res[i * 2 + 1];
    if (symbol.status === "success" && decimals.status === "success") {
      out.set(t.toLowerCase(), { symbol: String(symbol.result).slice(0, 16), decimals: Number(decimals.result) });
    }
  });
  return out;
}

/** Transfer logs in [from, to], split into chunks the RPC accepts and fetched in parallel. */
async function transferLogs(token: Address, from: bigint, to: bigint, args?: { from?: Address }) {
  const ranges: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += MAX_SPAN) {
    const end = start + MAX_SPAN - 1n < to ? start + MAX_SPAN - 1n : to;
    ranges.push([start, end]);
  }
  const chunks = await Promise.all(
    ranges.map(([fromBlock, toBlock]) =>
      logsClient.getLogs({ address: token, event: transferEvent, args, fromBlock, toBlock }),
    ),
  );
  return chunks.flat();
}

const tooMany = (e: unknown) => /exceeds limit|too many|query returned more/i.test((e as Error)?.message ?? "");

/**
 * Runs a log query over the most recent `want` blocks. The RPC refuses queries that match more than 10,000 logs,
 * which a busy token can do in hours, so the window is halved until the query fits.
 */
export async function recentLogs<T>(want: bigint, query: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>, floor = 5_000n) {
  const latest = await publicClient.getBlockNumber();
  let span = want > latest ? latest : want;
  for (;;) {
    try {
      const logs = await query(latest - span, latest);
      return { logs, span, latest };
    } catch (e) {
      if (!tooMany(e) || span <= floor) throw e;
      span /= 2n;
    }
  }
}

/**
 * A log query with no contract address (for example "every token transfer to this wallet") may only span 30,000
 * blocks on this RPC, so the window is cut into slices that are fetched in parallel.
 */
export async function slicedLogs<T>(want: bigint, query: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>, slice = 30_000n) {
  const latest = await publicClient.getBlockNumber();
  const span = want > latest ? latest : want;
  const ranges: [bigint, bigint][] = [];
  for (let end = latest; end > latest - span; end -= slice) {
    const start = end - slice + 1n > latest - span ? end - slice + 1n : latest - span + 1n;
    ranges.push([start, end]);
  }
  const parts = await Promise.all(ranges.map(([a, b]) => query(a, b).catch(() => [] as T[])));
  return { logs: parts.flat(), span, latest };
}

export function recentTransfers(token: Address, want: bigint) {
  return recentLogs(want, (fromBlock, toBlock) =>
    logsClient.getLogs({ address: token, event: transferEvent, fromBlock, toBlock }),
  ) as Promise<{ logs: TransferLog[]; span: bigint; latest: bigint }>;
}

/** how a token was created never changes, so it is looked up once and kept */
const births = new Map<string, Promise<Awaited<ReturnType<typeof readFirstMint>>>>();
export function firstMint(token: Address) {
  const key = token.toLowerCase();
  if (!births.has(key)) {
    const p = readFirstMint(token);
    births.set(key, p);
    p.catch(() => births.delete(key));
  }
  return births.get(key)!;
}

/** The first mint (Transfer from 0x0) gives the creation block and the wallet that launched the token. */
async function readFirstMint(token: Address) {
  const latest = await publicClient.getBlockNumber();
  const mints = await transferLogs(token, 0n, latest, { from: ZERO });
  if (mints.length === 0) return null;
  const first = mints.reduce((a, b) => (b.blockNumber! < a.blockNumber! ? b : a));
  const [tx, block] = await Promise.all([
    publicClient.getTransaction({ hash: first.transactionHash! }),
    publicClient.getBlock({ blockNumber: first.blockNumber! }),
  ]);
  return { log: first, deployer: tx.from, block, mintCount: mints.length, latest };
}

/**
 * Top holders among wallets that touched the token recently. Balances are read live, so the numbers are exact for
 * every wallet listed; wallets that never moved in the window are not seen.
 */
export async function topHolders(token: Address, totalSupply: bigint, windowBlocks = 3_000_000n) {
  const { logs, span } = await recentTransfers(token, windowBlocks);
  const seen = new Map<string, number>();
  for (const l of logs) {
    for (const a of [l.args.from, l.args.to]) {
      if (a && !DEAD.has(a.toLowerCase())) seen.set(a, (seen.get(a) ?? 0) + 1);
    }
  }
  // the busiest wallets first, so the pool and the big traders are always among the ones we check
  const candidates = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 600).map(([a]) => a as Address);
  const balances = await publicClient.multicall({
    contracts: candidates.map((a) => ({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [a] as const,
    })),
    // a few big calls instead of many small ones, so a busy RPC has less to refuse
    batchSize: 16_384,
  });
  // if the chain refused most of the reads, say so rather than report "nobody holds anything"
  if (candidates.length > 0 && balances.filter((b) => b.status === "success").length < candidates.length / 2) {
    throw new Error("the chain was too busy to read balances; try again");
  }
  const holders = candidates
    .map((address, i) => ({ address, balance: (balances[i].result as bigint | undefined) ?? 0n }))
    .filter((h) => h.balance > 0n)
    .sort((a, b) => (b.balance > a.balance ? 1 : -1));

  const codes = await Promise.all(holders.slice(0, 10).map((h) => publicClient.getCode({ address: h.address })));
  const pct = (b: bigint) => (totalSupply === 0n ? 0 : Number((b * 1_000_000n) / totalSupply) / 10_000);
  return {
    transfers: logs.length,
    activeWallets: seen.size,
    windowHours: blocksToHours(span),
    top: holders.slice(0, 10).map((h, i) => ({
      address: getAddress(h.address),
      pct: pct(h.balance),
      isContract: !!codes[i] && codes[i] !== "0x",
    })),
    top10Pct: pct(holders.slice(0, 10).reduce((s, h) => s + h.balance, 0n)),
  };
}

export const isDead = (a: string) => DEAD.has(a.toLowerCase());
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export type { Hex };
