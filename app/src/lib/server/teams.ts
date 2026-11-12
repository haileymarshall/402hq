import "server-only";
import { BaseError, ContractFunctionRevertedError, keccak256, toHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { vaultAbi } from "../abi";
import { publicClient } from "../chain";
import { PROFILES, SERVICES, type Service } from "../catalog";
import { agentName, readAgents, type AgentView } from "../market";
import { runService } from "../agents/run";
import { report as reportSchema, ruleVerdict, serviceResult, type Report, type ServiceResult } from "../agents/services";
import { refundJob, resolveEndpoint } from "./gateway";
import { PAYMENTS_ON, VAULTS, operator } from "./wallets";

/** One new launch after Scout had it checked. */
export type Hunted = {
  address: Address;
  symbol: string;
  ageMinutes: number;
  liquidityUsd: number;
  sameTicker: number;
  verdict: Report["verdict"];
  score: number;
  flags: string[];
  url: string;
};

/** `target` names what a hire is about when a team works on several things at once (Scout: the token). */
type Hire = { service: Service; agentId: number; name: string; target?: string };
export type TeamEvent =
  | { type: "start"; team: string; preview: boolean; input?: string }
  | ({ type: "consider"; ok: boolean; reason?: string } & Hire)
  | ({ type: "paid"; price: string; tx?: Hex } & Hire)
  | ({ type: "delivered"; result: ServiceResult } & Hire)
  | ({ type: "failed"; reason: string } & Hire)
  | ({ type: "refunded"; amount: string; tx?: Hex } & Hire)
  | { type: "report"; report: Report; results: ServiceResult[] }
  | { type: "hunt"; launches: Hunted[]; opened: number; windowHours: number }
  | { type: "error"; message: string };

type Emit = (e: TeamEvent) => void;
type Candidate = { id: number; name: string; slug?: string; price: string; endpoint?: string };
type Ctx = { vault: Address | ""; agents: AgentView[]; emit: Emit };

const newJobId = () => keccak256(toHex(`${Date.now()}-${Math.random()}-${crypto.randomUUID()}`));

function revertReason(e: unknown) {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) {
      return (r.data?.args?.[0] as string | undefined) ?? r.data?.errorName ?? r.shortMessage;
    }
    return e.shortMessage;
  }
  return (e as Error).message;
}

function candidates(service: Service, agents: AgentView[]): Candidate[] {
  if (PAYMENTS_ON) {
    // already ranked by trust score, then price
    return agents
      .filter((a) => a.service === service && a.active)
      .map((a) => ({ id: a.id, name: agentName(a), slug: a.profile?.slug, price: a.price, endpoint: a.endpoint }));
  }
  // preview: same ranking idea (a brand-new market ranks the cheapest first), no money moves
  return PROFILES.filter((p) => p.service === service)
    .sort((a, b) => a.price - b.price)
    .map((p) => ({ id: PROFILES.indexOf(p) + 1, name: p.name, slug: p.slug, price: String(p.price) }));
}

/** Pay through the team's vault (its on-chain rules apply), then call the agent with the job id, x402 style. */
async function hire(ctx: Ctx, c: Candidate, body: object, tag: Hire) {
  if (!PAYMENTS_ON) {
    ctx.emit({ type: "paid", ...tag, price: c.price });
    return { jobId: undefined, body: await runService(c.slug!, body as never) };
  }
  const url = resolveEndpoint(c.endpoint!);
  const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (first.status !== 402) throw new Error(`expected a 402 quote, got ${first.status}`);

  const jobId = newJobId();
  const tx = await operator!.writeContract({ address: ctx.vault as Address, abi: vaultAbi, functionName: "hire", args: [BigInt(c.id), jobId] });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  ctx.emit({ type: "paid", ...tag, price: c.price, tx });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payment": jobId },
    body: JSON.stringify(body),
  });
  return { jobId, body: res.ok ? ((await res.json()) as unknown) : { error: `HTTP ${res.status}` } };
}

/** Hire the best agent for a service that passes the vault's rules and delivers a valid result. */
async function fill<T>(ctx: Ctx, service: Service, body: object, validate: (x: unknown) => T, target?: string): Promise<T> {
  for (const c of candidates(service, ctx.agents)) {
    const tag: Hire = { service, agentId: c.id, name: c.name, target };
    if (PAYMENTS_ON) {
      try {
        await publicClient.readContract({ address: ctx.vault as Address, abi: vaultAbi, functionName: "check", args: [BigInt(c.id)] });
      } catch (e) {
        ctx.emit({ type: "consider", ...tag, ok: false, reason: revertReason(e) });
        continue;
      }
    }
    ctx.emit({ type: "consider", ...tag, ok: true });

    let jobId: Hex | undefined;
    try {
      const out = await hire(ctx, c, body, tag);
      jobId = out.jobId;
      const value = validate(out.body);
      if (service !== "report") ctx.emit({ type: "delivered", ...tag, result: value as ServiceResult });
      return value;
    } catch (e) {
      const reason = e instanceof Error && e.name === "ZodError" ? "returned an empty or broken result" : revertReason(e);
      ctx.emit({ type: "failed", ...tag, reason });
      if (jobId) {
        const tx = await refundJob(jobId).catch(() => undefined);
        ctx.emit({ type: "refunded", ...tag, amount: c.price, tx });
      } else if (!PAYMENTS_ON) {
        ctx.emit({ type: "refunded", ...tag, amount: c.price });
      }
    }
  }
  throw new Error(`no ${SERVICES[service].label.toLowerCase()} agent could do the job`);
}

async function context(slug: string, emit: Emit): Promise<Ctx> {
  const vault = VAULTS[slug] ?? "";
  if (PAYMENTS_ON && !vault) throw new Error("this lead agent has no funded wallet yet");
  return { vault, emit, agents: PAYMENTS_ON ? await readAgents() : [] };
}

// ------------------------------------------------------------------ Guardian: is this token safe?

/** the specialists Guardian hires for every token, all at once */
export const SAFETY_PIPELINE: Service[] = ["contract-scan", "holders", "liquidity", "deployer"];

export async function runGuardian(token: Address, emit: Emit) {
  emit({ type: "start", team: "guardian", preview: !PAYMENTS_ON, input: token });
  const ctx = await context("guardian", emit);

  // each specialist is hired, checked and (if it fails) refunded on its own
  const settled = await Promise.allSettled(
    SAFETY_PIPELINE.map((service) => fill(ctx, service, { input: token }, (x) => serviceResult.parse(x))),
  );
  const results = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (results.length === 0) throw new Error("no agent delivered");

  const report = await fill(ctx, "report", { input: token, results }, (x) => reportSchema.parse(x));
  emit({ type: "report", report, results });
}

// ------------------------------------------------------------------ Scout: which new launches are worth a look?

const launchList = z.object({
  opened: z.number(),
  windowHours: z.number(),
  launches: z.array(
    z.object({
      address: z.string(),
      symbol: z.string(),
      ageMinutes: z.number(),
      liquidityUsd: z.number(),
      sameTicker: z.number(),
      url: z.string(),
    }),
  ),
});

/** each launch gets these two checks */
export const HUNT_CHECKS: Service[] = ["contract-scan", "liquidity"];
const HUNT_SIZE = 3;

export async function runScout(emit: Emit) {
  emit({ type: "start", team: "scout", preview: !PAYMENTS_ON });
  const ctx = await context("scout", emit);

  const radar = await fill(ctx, "launch-radar", {}, (x) => serviceResult.parse(x));
  const found = launchList.parse(radar.data);
  const targets = found.launches.slice(0, HUNT_SIZE);
  if (targets.length === 0) {
    emit({ type: "hunt", launches: [], opened: found.opened, windowHours: found.windowHours });
    return;
  }

  const hunted = await Promise.all(
    targets.map(async (t): Promise<Hunted> => {
      // copycats share a ticker, so those are told apart by the end of their address
      const label = t.sameTicker > 1 ? `${t.symbol} …${t.address.slice(-4)}` : t.symbol;
      const settled = await Promise.allSettled(
        HUNT_CHECKS.map((service) => fill(ctx, service, { input: t.address }, (x) => serviceResult.parse(x), label)),
      );
      const results = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
      const verdict = ruleVerdict(results);
      const flags = results
        .flatMap((r) => r.findings)
        .filter((f) => f.level === "danger" || f.level === "warn")
        .sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1))
        .map((f) => f.title);
      if (t.sameTicker > 1) flags.unshift(`${t.sameTicker} new tokens use this ticker`);
      return {
        address: t.address as Address,
        symbol: t.symbol,
        ageMinutes: t.ageMinutes,
        liquidityUsd: t.liquidityUsd,
        sameTicker: t.sameTicker,
        verdict: results.length === 0 ? "RISKY" : verdict.verdict,
        score: results.length === 0 ? 0 : Math.max(0, verdict.score - (t.sameTicker > 1 ? 15 : 0)),
        flags: flags.slice(0, 4),
        url: t.url,
      };
    }),
  );
  emit({ type: "hunt", launches: hunted.sort((a, b) => b.score - a.score), opened: found.opened, windowHours: found.windowHours });
}
