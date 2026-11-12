import { runService } from "@/lib/agents/run";
import { paywall } from "@/lib/server/x402";

export const maxDuration = 60;

/** One specialist agent. Unpaid requests get a 402 quote; paid ones (X-PAYMENT: jobId) get the work. */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[slug]">) {
  const { slug } = await ctx.params;
  const { deny } = await paywall(req, slug);
  if (deny) return deny;
  try {
    return Response.json(await runService(slug, await req.json()));
  } catch (e) {
    // 422: the buyer sent something we can't work on (not the agent's fault). 500: we failed, so the job is refundable.
    const message = (e as Error).message ?? "failed";
    const badInput = /^(send |not an ERC-20|no such transaction|no contract at)/.test(message) || (e as Error).name === "ZodError";
    return Response.json({ error: message }, { status: badInput ? 422 : 500 });
  }
}
