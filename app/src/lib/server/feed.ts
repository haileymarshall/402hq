import "server-only";
import { formatUnits, parseAbiItem, type Address } from "viem";
import { marketAbi, routerAbi } from "../abi";
import { LIVE, MARKET, MARKET_DEPLOY_BLOCK, ROUTER, WIF, publicClient, logsClient } from "../chain";
import { SECONDS_PER_BLOCK } from "../agents/onchain";
import { mainPair, pairsFor } from "../agents/dex";
import { PROFILES } from "../catalog";
import { agentName, previewAgents, readAgents, type AgentView, type FeedItem, type Rates, type Totals } from "../market";
import { PAYMENTS_ON, VAULTS } from "./wallets";

const paidEvent = parseAbiItem(
  "event JobPaid(bytes32 indexed jobId, uint256 indexed agentId, address indexed buyer, uint256 amount, uint256 burned, uint256 backerCut)",
);
const refundedEvent = parseAbiItem(
  "event JobRefunded(bytes32 indexed jobId, uint256 indexed agentId, address indexed buyer, uint256 refunded, uint256 burned, uint256 fromBond, uint256 fromStake)",
);
const SPAN = 10_000_000n;
const wif = (v: bigint) => formatUnits(v, 18);

/** vault address → the lead agent that owns it, so the ledger can say "Guardian hired Sentinel" */
const teamByVault = new Map(
  Object.entries(VAULTS)
    .filter(([, v]) => v)
    .map(([slug, v]) => [(v as string).toLowerCase(), PROFILES.find((p) => p.slug === slug)?.name ?? slug]),
);

async function logsSince<E extends typeof paidEvent | typeof refundedEvent>(event: E, latest: bigint) {
  const ranges: [bigint, bigint][] = [];
  for (let a = MARKET_DEPLOY_BLOCK; a <= latest; a += SPAN) ranges.push([a, a + SPAN - 1n < latest ? a + SPAN - 1n : latest]);
  const parts = await Promise.all(
    ranges.map(([fromBlock, toBlock]) => logsClient.getLogs({ address: MARKET as Address, event, fromBlock, toBlock })),
  );
  return parts.flat();
}

async function readFeed(agents: AgentView[]) {
  const latest = await publicClient.getBlockNumber();
  const [paid, refunded] = await Promise.all([logsSince(paidEvent, latest), logsSince(refundedEvent, latest)]);
  const name = (id: bigint) => {
    const a = agents.find((x) => x.id === Number(id));
    return a ? agentName(a) : `Agent #${id}`;
  };
  const row = (l: (typeof paid)[number] | (typeof refunded)[number], kind: FeedItem["kind"], amount: bigint): FeedItem => ({
    kind,
    jobId: l.args.jobId!,
    agentId: Number(l.args.agentId),
    agent: name(l.args.agentId!),
    buyer: l.args.buyer!,
    buyerName: teamByVault.get(l.args.buyer!.toLowerCase()),
    amount: wif(amount),
    burned: wif(l.args.burned!),
    tx: l.transactionHash!,
    block: Number(l.blockNumber),
    ago: Math.round(Number(latest - l.blockNumber!) * SECONDS_PER_BLOCK),
  });
  const items = [
    ...paid.map((l) => row(l, "paid", l.args.amount!)),
    ...refunded.map((l) => row(l, "refunded", (l as (typeof refunded)[number]).args.refunded!)),
  ].sort((a, b) => b.block - a.block);
  const volume = paid.reduce((s, l) => s + l.args.amount!, 0n);
  return { items, volume: wif(volume), jobs: paid.length };
}

/** $WIF in dollars and in ETH. ETH comes from the router's own quote when it is deployed, so it is what a buyer pays. */
async function readRates(): Promise<Rates> {
  const pair = mainPair(await pairsFor([WIF]).catch(() => []), WIF);
  const rates = { wifUsd: Number(pair?.priceUsd ?? 0), wifEth: Number(pair?.priceNative ?? 0), wifUsdg: Number(pair?.priceUsd ?? 0) };
  if (ROUTER) {
    const thousand = 1000n * 10n ** 18n;
    const [eth, usdg] = await Promise.allSettled([
      publicClient.simulateContract({ address: ROUTER, abi: routerAbi, functionName: "quoteEth", args: [thousand] }),
      publicClient.simulateContract({ address: ROUTER, abi: routerAbi, functionName: "quoteUsdg", args: [thousand] }),
    ]);
    if (eth.status === "fulfilled") rates.wifEth = Number(formatUnits(eth.value.result, 18)) / 1000;
    if (usdg.status === "fulfilled") rates.wifUsdg = Number(formatUnits(usdg.value.result, 6)) / 1000;
  }
  return rates;
}

export type MarketSnapshot = {
  live: boolean;
  paymentsOn: boolean;
  /** jobs can be paid in ETH or USDG (the router is deployed) */
  ethOn: boolean;
  agents: AgentView[];
  totals: Totals;
  feed: FeedItem[];
  rates: Rates;
};

let cached: { at: number; data: MarketSnapshot } | null = null;
let ratesCache: { at: number; data: Rates } | null = null;

async function rates() {
  if (!ratesCache || Date.now() - ratesCache.at > 60_000) ratesCache = { at: Date.now(), data: await readRates() };
  return ratesCache.data;
}

/** Everything the pages show about the market, read from the chain and kept for a few seconds. */
export async function marketSnapshot(): Promise<MarketSnapshot> {
  if (cached && Date.now() - cached.at < 4_000) return cached.data;
  const r = await rates().catch(() => ({ wifUsd: 0, wifEth: 0, wifUsdg: 0 }));
  let data: MarketSnapshot;
  if (!LIVE) {
    const agents = previewAgents();
    data = {
      live: false,
      paymentsOn: false,
      ethOn: false,
      agents,
      totals: { burned: "0", agents: agents.length, jobs: 0, insured: String(agents.reduce((s, a) => s + Number(a.backing), 0)), volume: "0" },
      feed: [],
      rates: r,
    };
  } else {
    const agents = await readAgents();
    const [burned, feed] = await Promise.all([
      publicClient.readContract({ address: MARKET as Address, abi: marketAbi, functionName: "totalBurned" }),
      readFeed(agents),
    ]);
    data = {
      live: true,
      paymentsOn: PAYMENTS_ON,
      ethOn: !!ROUTER,
      agents,
      totals: {
        burned: wif(burned),
        agents: agents.length,
        jobs: feed.jobs,
        insured: String(agents.reduce((s, a) => s + Number(a.backing), 0)),
        volume: feed.volume,
      },
      feed: feed.items.slice(0, 40),
      rates: r,
    };
  }
  cached = { at: Date.now(), data };
  return data;
}
