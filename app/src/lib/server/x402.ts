import "server-only";
import { isHex, type Address, type Hex } from "viem";
import { marketAbi } from "../abi";
import { MARKET, ROUTER, USDG, WIF, publicClient, robinhood } from "../chain";
import { agentName, readAgents, type AgentView } from "../market";
import { PAYMENTS_ON } from "./wallets";

/**
 * x402-style paywall. $WIF has no permit / EIP-3009, so instead of a signed transfer the buyer pays on-chain and
 * retries with the job id in the X-PAYMENT header. Two ways to pay, both settle in $WIF:
 *   - AgentMarket.pay(agentId, jobId, maxPrice) with $WIF
 *   - PayRouter.payWithEth(agentId, jobId, maxPrice) with ETH: the router buys the $WIF and pays in one transaction
 * We then check the job on-chain: paid, to this agent, recently, and not used before.
 */
const served = new Set<string>();
export const alreadyServed = (jobId: string) => served.has(jobId);

export type Quote = {
  x402Version: 1;
  error: string;
  accepts: {
    scheme: "wif-market-job";
    network: string;
    asset: Address;
    payTo: Address;
    /** send ETH here instead and it is swapped to $WIF for you */
    ethRouter?: Address;
    agentId: number;
    maxAmountRequired: string;
    description: string;
  }[];
};

export async function agentBySlug(slug: string) {
  const agents = await readAgents();
  return agents.find((a) => a.profile?.slug === slug);
}

/** an agent by its on-chain id ("7") or, for the agents we run, its name ("sentinel") */
export async function agentByKey(key: string) {
  const agents = await readAgents();
  return /^\d+$/.test(key) ? agents.find((a) => a.id === Number(key)) : agents.find((a) => a.profile?.slug === key);
}

export function quoteFor(agent: AgentView): Quote {
  return {
    x402Version: 1,
    error: "payment required",
    accepts: [
      {
        scheme: "wif-market-job",
        network: `eip155:${robinhood.id}`,
        asset: WIF,
        payTo: MARKET as Address,
        // the router takes ETH (payWithEth) or USDG (payWithUsdg) and settles the job in $WIF in the same transaction
        ...(ROUTER ? { ethRouter: ROUTER, usdgRouter: ROUTER, usdg: USDG } : {}),
        agentId: agent.id,
        maxAmountRequired: agent.price,
        description: `${agentName(agent)}: one job`,
      },
    ],
  };
}

/** Is `jobId` a fresh, paid, unrefunded job for this agent? */
export async function checkJob(jobId: string, agentId: number): Promise<{ ok: true; jobId: Hex } | { ok: false; deny: Response }> {
  if (!isHex(jobId) || jobId.length !== 66) {
    return { ok: false, deny: Response.json({ error: "bad X-PAYMENT job id" }, { status: 400 }) };
  }
  const [, paidAgent, paidAt, status] = await publicClient.readContract({
    address: MARKET as Address,
    abi: marketAbi,
    functionName: "jobs",
    args: [jobId],
  });
  const fresh = Date.now() / 1000 - Number(paidAt) < 15 * 60;
  if (status !== 1 || Number(paidAgent) !== agentId || !fresh) {
    return { ok: false, deny: Response.json({ error: "no valid payment for this job" }, { status: 402 }) };
  }
  return { ok: true, jobId };
}

/** For an agent's own endpoint: lets a paid request through once, or returns the 402 quote / error to send back. */
export async function paywall(req: Request, slug: string): Promise<{ jobId: Hex | null; deny: Response | null }> {
  if (!PAYMENTS_ON) return { jobId: null, deny: null }; // preview mode: free, and the UI says so

  const agent = await agentBySlug(slug);
  if (!agent) return { jobId: null, deny: Response.json({ error: "agent not listed on the market" }, { status: 404 }) };

  const header = req.headers.get("x-payment");
  if (!header) return { jobId: null, deny: Response.json(quoteFor(agent), { status: 402 }) };
  if (served.has(header)) return { jobId: null, deny: Response.json({ error: "job already served" }, { status: 409 }) };

  const job = await checkJob(header, agent.id);
  if (!job.ok) return { jobId: null, deny: job.deny };
  served.add(job.jobId);
  return { jobId: job.jobId, deny: null };
}
