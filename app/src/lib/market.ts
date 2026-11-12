import { formatUnits, type Address } from "viem";
import { marketAbi } from "./abi";
import { LIVE, MARKET, publicClient } from "./chain";
import { PROFILES, slugFromEndpoint, type Profile } from "./catalog";

export type AgentView = {
  id: number;
  owner: Address;
  payout: Address;
  service: string;
  endpoint: string;
  price: string; // WIF, decimal string
  backerPct: number;
  active: boolean;
  jobsDone: number;
  jobsFailed: number;
  bond: string;
  stake: string;
  backing: string;
  score: number;
  profile?: Profile;
};

/** one line of the public ledger: a job that was paid for, or one that was refunded */
export type FeedItem = {
  kind: "paid" | "refunded";
  jobId: string;
  agentId: number;
  agent: string;
  buyer: Address;
  /** set when the buyer is one of our lead agents, i.e. an agent hiring an agent */
  buyerName?: string;
  amount: string;
  burned: string;
  tx: string;
  block: number;
  /** seconds ago, estimated from the block number */
  ago: number;
};

export type Totals = { burned: string; agents: number; jobs: number; insured: string; volume: string };
/** what one $WIF costs: in dollars, and what a buyer pays for it in ETH and in USDG through the router */
export type Rates = { wifUsd: number; wifEth: number; wifUsdg: number };

const wif = (v: bigint) => formatUnits(v, 18);

/**
 * 0–1,000. Mostly delivery record (smoothed so one job doesn't decide everything), then volume, then how much
 * $WIF is at risk behind the agent.
 */
export function trustScore(done: number, failed: number, backingWif: number) {
  const reliability = (done + 1) / (done + failed + 2);
  const volume = Math.min(1, Math.log10(done + 1) / 3);
  const backing = Math.min(1, Math.log10(1 + backingWif / 1_000) / 2);
  return Math.round(1000 * (0.6 * reliability + 0.2 * volume + 0.2 * backing));
}

/** Before the market is deployed: our agents with their default prices, a fresh record and no money behind them. */
export function previewAgents(): AgentView[] {
  return PROFILES.map((p, i) => ({
    id: i + 1,
    owner: "0x0000000000000000000000000000000000000000",
    payout: "0x0000000000000000000000000000000000000000",
    service: p.service,
    endpoint: "",
    price: String(p.price),
    backerPct: 20,
    active: true,
    jobsDone: 0,
    jobsFailed: 0,
    bond: String(p.bond),
    stake: "0",
    backing: String(p.bond),
    score: trustScore(0, 0, p.bond),
    profile: p,
  }));
}

export async function readAgents(): Promise<AgentView[]> {
  if (!LIVE) return [];
  const count = await publicClient.readContract({ address: MARKET as Address, abi: marketAbi, functionName: "agentCount" });
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
  const rows = await publicClient.multicall({
    contracts: ids.map((id) => ({ address: MARKET as Address, abi: marketAbi, functionName: "getAgent" as const, args: [id] as const })),
    allowFailure: false,
  });
  return rows
    .map((a, i) => {
      const backing = a.bond + a.totalStake;
      const done = Number(a.jobsDone);
      const failed = Number(a.jobsFailed);
      const slug = slugFromEndpoint(a.endpoint);
      return {
        id: i + 1,
        owner: a.owner,
        payout: a.payout,
        service: a.service,
        endpoint: a.endpoint,
        price: wif(a.price),
        backerPct: a.backerBps / 100,
        active: a.active,
        jobsDone: done,
        jobsFailed: failed,
        bond: wif(a.bond),
        stake: wif(a.totalStake),
        backing: wif(backing),
        score: trustScore(done, failed, Number(wif(backing))),
        profile: slug ? PROFILES.find((p) => p.slug === slug) : undefined,
      };
    })
    .sort((a, b) => b.score - a.score || Number(a.price) - Number(b.price));
}

export const agentName = (a: Pick<AgentView, "id" | "profile">) => a.profile?.name ?? `Agent #${a.id}`;
