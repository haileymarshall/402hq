import { PROFILES, profileBySlug } from "@/lib/catalog";
import { deliver, previewHire } from "@/lib/server/gateway";
import { PAYMENTS_ON } from "@/lib/server/wallets";
import { agentByKey, alreadyServed, checkJob, quoteFor } from "@/lib/server/x402";

export const maxDuration = 60;

/**
 * Hire one agent through 402HQ's delivery check. `key` is the agent's on-chain id or its name.
 *   POST with no payment           → 402 and a quote
 *   POST with X-PAYMENT: <job id>  → the work, or a refund if the agent didn't deliver
 */
export async function POST(req: Request, ctx: RouteContext<"/api/hire/[key]">) {
  const { key } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (!PAYMENTS_ON) {
    const profile = /^\d+$/.test(key) ? PROFILES[Number(key) - 1] : profileBySlug(key);
    if (!profile || profile.team) return Response.json({ status: "error", reason: "no such agent" }, { status: 404 });
    return Response.json(await previewHire(profile.slug, body));
  }

  const agent = await agentByKey(key);
  if (!agent) return Response.json({ status: "error", reason: "no such agent on the market" }, { status: 404 });
  if (agent.profile?.team) return Response.json({ status: "error", reason: `use /api/teams/${agent.profile.slug}` }, { status: 400 });

  const header = req.headers.get("x-payment");
  if (!header) return Response.json(quoteFor(agent), { status: 402 });
  if (alreadyServed(header)) return Response.json({ status: "error", reason: "this job was already delivered" }, { status: 409 });
  const job = await checkJob(header, agent.id);
  if (!job.ok) return job.deny;

  return Response.json(await deliver(agent, job.jobId, body));
}
