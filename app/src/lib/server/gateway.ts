import "server-only";
import type { Address, Hex } from "viem";
import { marketAbi } from "../abi";
import { MARKET, publicClient } from "../chain";
import { profileBySlug } from "../catalog";
import { runService, type JobBody } from "../agents/run";
import { serviceResult, type ServiceResult } from "../agents/services";
import type { AgentView } from "../market";
import { arbiter } from "./wallets";

export type HireOutcome =
  | { status: "delivered"; result: ServiceResult; preview: boolean }
  | { status: "refunded"; reason: string; amount: string; tx?: Hex; preview: boolean }
  | { status: "error"; reason: string };

/** Lets local dev hit its own agents instead of the deployed URLs written on-chain. */
/** the hosts our own agents were listed under on-chain */
const OWN_HOSTS = new Set(["402hq.xyz", "www.402hq.xyz", "localhost"]);

/**
 * Where to call an agent. AGENTS_BASE_URL reroutes our own agents (local dev, or while the domain written on-chain is
 * still coming up); anything a third party listed is always called at its own URL.
 */
export function resolveEndpoint(endpoint: string) {
  const base = process.env.AGENTS_BASE_URL;
  if (!base) return endpoint;
  const url = new URL(endpoint);
  if (!OWN_HOSTS.has(url.hostname)) return endpoint;
  return new URL(url.pathname, base).toString();
}

export async function refundJob(jobId: Hex) {
  const tx = await arbiter!.writeContract({ address: MARKET as Address, abi: marketAbi, functionName: "refund", args: [jobId] });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

const broken = (e: unknown) =>
  e instanceof Error && e.name === "ZodError" ? "it returned an empty or broken result" : ((e as Error).message ?? "it did not answer");

/** Preview mode: run one of our agents directly and apply the same delivery check. No money moves. */
export async function previewHire(slug: string, body: JobBody): Promise<HireOutcome> {
  const profile = profileBySlug(slug);
  if (!profile) return { status: "error", reason: "unknown agent" };
  try {
    return { status: "delivered", result: serviceResult.parse(await runService(slug, body)), preview: true };
  } catch (e) {
    if (profile.trickster) return { status: "refunded", reason: broken(e), amount: String(profile.price), preview: true };
    return { status: "error", reason: (e as Error).message };
  }
}

/**
 * 402HQ's delivery check for a paid job. We call the agent with the buyer's payment, and the work has to come back
 * in the agreed shape (a summary and at least one finding). If it doesn't, the job is refunded from the agent's
 * insurance on the spot. A buyer's bad input (for example a wrong address) is not the agent's fault and is not refunded.
 */
export async function deliver(agent: AgentView, jobId: Hex, body: JobBody): Promise<HireOutcome> {
  let reason: string;
  try {
    const res = await fetch(resolveEndpoint(agent.endpoint), {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment": jobId },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55_000),
    });
    if (res.status === 409) return { status: "error", reason: "this job was already delivered" };
    const json: unknown = await res.json().catch(() => null);
    if (res.status === 422) {
      // the agent understood the job and says the input was wrong: nobody failed
      return { status: "error", reason: (json as { error?: string } | null)?.error ?? "the agent rejected the input" };
    }
    if (res.ok) return { status: "delivered", result: serviceResult.parse(json), preview: false };
    reason = `it answered with HTTP ${res.status}`;
  } catch (e) {
    reason = broken(e);
  }
  const tx = await refundJob(jobId).catch(() => undefined);
  return { status: "refunded", reason, amount: agent.price, tx, preview: false };
}
