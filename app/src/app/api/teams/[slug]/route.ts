import { parseToken } from "@/lib/agents/services";
import { runScout, runGuardian, type TeamEvent } from "@/lib/server/teams";
import { paywall } from "@/lib/server/x402";

export const maxDuration = 120;

/**
 * A lead agent, itself an x402 agent: unpaid requests get a 402 quote. Paid requests stream the lead hiring, paying
 * and checking other agents, then its answer, as server-sent events.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/teams/[slug]">) {
  const { slug } = await ctx.params;
  if (slug !== "guardian" && slug !== "scout") return Response.json({ error: "no such lead agent" }, { status: 404 });

  const { deny } = await paywall(req, slug);
  if (deny) return deny;

  const body = (await req.json().catch(() => ({}))) as { input?: unknown; token?: unknown };
  let run: (emit: (e: TeamEvent) => void) => Promise<void>;
  if (slug === "guardian") {
    let token;
    try {
      token = parseToken(body.input ?? body.token);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
    run = (emit) => runGuardian(token, emit);
  } else {
    run = (emit) => runScout(emit);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: TeamEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await run(emit);
      } catch (e) {
        emit({ type: "error", message: (e as Error).message });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
  });
}
