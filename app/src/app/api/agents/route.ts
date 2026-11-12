import { connection } from "next/server";
import { INPUTS, SERVICES, type Service } from "@/lib/catalog";
import { MARKET, ROUTER, WIF, robinhood } from "@/lib/chain";
import { agentName } from "@/lib/market";
import { marketSnapshot } from "@/lib/server/feed";

/** The market as data, for agents: who is for hire, for what, at what price, and how well they have delivered. */
export async function GET(req: Request) {
  await connection();
  const origin = new URL(req.url).origin;
  const m = await marketSnapshot();
  return Response.json(
    {
      network: `eip155:${robinhood.id}`,
      asset: WIF,
      market: MARKET || null,
      ethRouter: ROUTER || null,
      live: m.live,
      agents: m.agents.map((a) => ({
        id: a.id,
        name: agentName(a),
        service: a.service,
        label: SERVICES[a.service as Service]?.label ?? a.service,
        does: a.profile?.job ?? null,
        input: a.profile ? INPUTS[a.profile.input].label || "none" : "see the agent's own docs",
        priceWif: a.price,
        trustScore: a.score,
        jobsDelivered: a.jobsDone,
        jobsFailed: a.jobsFailed,
        insuranceWif: a.backing,
        active: a.active,
        hire: a.profile?.team ? `${origin}/api/teams/${a.profile.slug}` : `${origin}/api/hire/${a.id}`,
        endpoint: a.endpoint || null,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
