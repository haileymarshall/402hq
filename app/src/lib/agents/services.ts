import { erc20Abi, getAddress, isAddress, type Address } from "viem";
import { generateText, Output } from "ai";
import { z } from "zod";
import { publicClient } from "../chain";
import { firstMint, tokenBasics, topHolders } from "./onchain";

/** What every service returns. The lead agent checks this before it accepts a job as delivered. */
export const finding = z.object({
  level: z.enum(["ok", "info", "warn", "danger"]),
  title: z.string().min(3),
  detail: z.string().min(3),
});
export type Finding = z.infer<typeof finding>;

export const serviceResult = z.object({
  service: z.string(),
  summary: z.string().min(10),
  findings: z.array(finding).min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type ServiceResult = z.infer<typeof serviceResult>;

export const report = z.object({
  verdict: z.enum(["SAFE", "CAUTION", "RISKY"]),
  score: z.number().min(0).max(100),
  headline: z.string(),
  reasons: z.array(z.string()).min(1).max(6),
});
export type Report = z.infer<typeof report>;

export function parseToken(input: unknown): Address {
  if (typeof input !== "string" || !isAddress(input)) throw new Error("send a token address");
  return getAddress(input);
}

export function parseAddress(input: unknown, what = "an address"): Address {
  if (typeof input !== "string" || !isAddress(input)) throw new Error(`send ${what}`);
  return getAddress(input);
}

export function parseTx(input: unknown): `0x${string}` {
  if (typeof input !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input)) throw new Error("send a transaction hash");
  return input as `0x${string}`;
}

export const AI_ON = !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
export const AI_MODEL = process.env.AI_MODEL || "anthropic/claude-sonnet-5-5";

// ------------------------------------------------------------------ contract scan

// functions that give the owner power over holders
const POWERS: [string, string, Finding["level"]][] = [
  ["40c10f19", "mint(address,uint256): the owner can create new tokens", "danger"],
  ["a0712d68", "mint(uint256): new tokens can be created", "danger"],
  ["8456cb59", "pause(): transfers can be frozen", "warn"],
  ["f9f92be4", "blacklist(address): wallets can be blocked", "danger"],
  ["44337ea1", "addToBlacklist(address): wallets can be blocked", "danger"],
  ["69fe0e2d", "setFee(uint256): the owner can change the fee", "warn"],
  ["8ee88c53", "setTaxFee: the owner can change the tax", "warn"],
  ["e01af92c", "setSwapEnabled: selling can be switched off", "danger"],
  ["c9567bf9", "openTrading(): trading is switched on by the owner", "warn"],
  ["5342acb4", "isExcludedFromFee: some wallets skip fees", "warn"],
  ["ec28438a", "setMaxTxAmount: the owner can cap trade sizes", "warn"],
];
const EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export async function contractScan(token: Address): Promise<ServiceResult> {
  const [code, basics, owner, impl] = await Promise.all([
    publicClient.getCode({ address: token }),
    tokenBasics(token),
    publicClient
      .readContract({
        address: token,
        abi: [{ type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }],
        functionName: "owner",
      })
      .catch(() => null),
    publicClient.getStorageAt({ address: token, slot: EIP1967_IMPL }),
  ]);
  if (!code || code === "0x") throw new Error("no contract at this address");

  const findings: Finding[] = [];
  const isProxy = !!impl && BigInt(impl) !== 0n;
  if (isProxy) {
    findings.push({ level: "danger", title: "Upgradeable proxy", detail: "The code can be swapped for new code at any time." });
  }

  const renounced = owner === null || /^0x0{40}$/i.test(owner) || owner.toLowerCase().endsWith("dead");
  const powers = POWERS.filter(([sel]) => code.includes(sel));
  for (const [, what, level] of powers) {
    findings.push({
      level: renounced && level === "danger" ? "warn" : level,
      title: what.split(":")[0],
      detail: what.split(": ")[1] + (renounced ? " (but ownership is renounced)" : ""),
    });
  }
  findings.push(
    owner === null
      ? { level: "ok", title: "No owner role", detail: "The contract has no owner() function." }
      : renounced
        ? { level: "ok", title: "Ownership renounced", detail: "Nobody controls the owner functions." }
        : { level: "warn", title: "Has an owner", detail: `Owner ${owner} can call admin functions.` },
  );
  if (powers.length === 0 && !isProxy) {
    findings.push({ level: "ok", title: "No dangerous functions found", detail: "No mint, blacklist, pause or fee switches in the code." });
  }

  const dangers = findings.filter((f) => f.level === "danger").length;
  return {
    service: "contract-scan",
    summary: `${basics.symbol}: ${dangers === 0 ? "no owner traps found in the code" : `${dangers} dangerous power(s) in the code`}.`,
    findings,
    data: { owner, isProxy, codeSize: (code.length - 2) / 2, symbol: basics.symbol },
  };
}

// ------------------------------------------------------------------ holders

export async function holderAnalysis(token: Address): Promise<ServiceResult> {
  const basics = await tokenBasics(token);
  const h = await topHolders(token, basics.totalSupply);
  const findings: Finding[] = [];
  const biggest = h.top[0];
  if (biggest) {
    findings.push({
      level: biggest.pct > 20 && !biggest.isContract ? "danger" : biggest.pct > 10 ? "warn" : "ok",
      title: `Largest wallet holds ${biggest.pct.toFixed(2)}%`,
      detail: biggest.isContract ? "It's a contract (often the liquidity pool)." : `${biggest.address} is a normal wallet.`,
    });
  }
  findings.push({
    level: h.top10Pct > 60 ? "danger" : h.top10Pct > 35 ? "warn" : "ok",
    title: `Top 10 wallets hold ${h.top10Pct.toFixed(1)}%`,
    detail: `Across ${h.activeWallets} wallets that traded recently.`,
  });
  findings.push({
    level: h.transfers < 20 ? "warn" : "ok",
    title: `${h.transfers} transfers in the last ${Math.round(h.windowHours)} hours`,
    detail: h.transfers < 20 ? "Very little activity." : "The token is actively moving.",
  });
  return {
    service: "holders",
    summary: `Top 10 active wallets hold ${h.top10Pct.toFixed(1)}% of ${basics.symbol}.`,
    findings,
    data: h,
  };
}

// ------------------------------------------------------------------ liquidity

type DexPair = {
  dexId: string;
  labels?: string[];
  url: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys: number; sells: number } };
  fdv?: number;
  pairCreatedAt?: number;
};

export async function liquidityCheck(token: Address): Promise<ServiceResult> {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, { cache: "no-store" });
  const body = (await res.json()) as { pairs?: (DexPair & { chainId: string })[] };
  const pairs = (body.pairs ?? []).filter((p) => p.chainId === "robinhood");
  if (pairs.length === 0) {
    return {
      service: "liquidity",
      summary: "No trading pool found. You may not be able to buy or sell.",
      findings: [{ level: "danger", title: "No liquidity", detail: "No DEX pool for this token on Robinhood Chain." }],
    };
  }
  const main = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
  const liq = pairs.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0);
  const vol = pairs.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0);
  const buys = main.txns?.h24?.buys ?? 0;
  const sells = main.txns?.h24?.sells ?? 0;
  const ageDays = main.pairCreatedAt ? (Date.now() - main.pairCreatedAt) / 86_400_000 : null;
  const usd = (n: number) => `$${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0)}`;

  const findings: Finding[] = [
    {
      level: liq < 5_000 ? "danger" : liq < 50_000 ? "warn" : "ok",
      title: `${usd(liq)} liquidity`,
      detail: liq < 5_000 ? "Too thin: a small sale moves the price a lot." : `Main pool on ${main.dexId} ${(main.labels ?? []).join(" ")}.`,
    },
    {
      level: sells === 0 && buys > 5 ? "danger" : "ok",
      title: `${buys} buys / ${sells} sells in 24h`,
      detail: sells === 0 && buys > 5 ? "Nobody has sold: possible honeypot." : "People are both buying and selling.",
    },
    { level: vol < 1_000 ? "warn" : "ok", title: `${usd(vol)} volume in 24h`, detail: "Total across all pools." },
  ];
  if (ageDays !== null) {
    findings.push({
      level: ageDays < 2 ? "warn" : "ok",
      title: `Pool is ${ageDays < 1 / 24 ? `${Math.max(1, Math.round(ageDays * 1440))} minutes` : ageDays < 1 ? `${Math.round(ageDays * 24)} hours` : `${Math.round(ageDays)} days`} old`,
      detail: ageDays < 2 ? "Brand new pools are where most rugs happen." : "It has been trading for a while.",
    });
  }
  return {
    service: "liquidity",
    summary: `${usd(liq)} liquidity and ${usd(vol)} traded in the last 24 hours.`,
    findings,
    data: { priceUsd: main.priceUsd, liquidityUsd: liq, volume24h: vol, fdv: main.fdv, pairs: pairs.length, url: main.url },
  };
}

// ------------------------------------------------------------------ deployer

export async function deployerProfile(token: Address): Promise<ServiceResult> {
  const [basics, mint] = await Promise.all([tokenBasics(token), firstMint(token)]);
  if (!mint) {
    return {
      service: "deployer",
      summary: "Couldn't find how this token was created.",
      findings: [{ level: "warn", title: "Unknown origin", detail: "No mint event was found." }],
    };
  }
  const [txCount, ethBalance, held] = await Promise.all([
    publicClient.getTransactionCount({ address: mint.deployer }),
    publicClient.getBalance({ address: mint.deployer }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [mint.deployer] }),
  ]);
  const heldPct = basics.totalSupply === 0n ? 0 : Number((held * 10_000n) / basics.totalSupply) / 100;
  const ageDays = (Date.now() / 1000 - Number(mint.block.timestamp)) / 86_400;

  const findings: Finding[] = [
    {
      level: heldPct > 10 ? "danger" : heldPct > 3 ? "warn" : "ok",
      title: `Creator holds ${heldPct.toFixed(2)}%`,
      detail: heldPct > 10 ? "The creator could dump a big share on buyers." : "The creator's own bag is small.",
    },
    {
      level: txCount < 5 ? "warn" : "ok",
      title: `Creator wallet has sent ${txCount} transactions`,
      detail: txCount < 5 ? "A fresh wallet, often used for throwaway launches." : "An established wallet.",
    },
    {
      level: ageDays < 2 ? "warn" : "ok",
      title: `Token is ${ageDays < 1 / 24 ? `${Math.max(1, Math.round(ageDays * 1440))} minutes` : ageDays < 1 ? `${Math.round(ageDays * 24)} hours` : `${Math.round(ageDays)} days`} old`,
      detail: `First minted in block ${mint.block.number}.`,
    },
  ];
  if (mint.mintCount > 1) {
    findings.push({ level: "warn", title: `${mint.mintCount} mint events`, detail: "Supply has been created more than once." });
  }
  return {
    service: "deployer",
    summary: `Launched by ${mint.deployer.slice(0, 8)}…, who still holds ${heldPct.toFixed(2)}%.`,
    findings,
    data: { deployer: mint.deployer, heldPct, txCount, ethBalance: ethBalance.toString(), ageDays },
  };
}

// ------------------------------------------------------------------ writer

const WEIGHT = { ok: 0, info: 0, warn: 8, danger: 25 } as const;

/** Rule-based verdict, used when no AI key is configured and as a floor the AI can't argue below. */
export function ruleVerdict(results: ServiceResult[]): Report {
  const all = results.flatMap((r) => r.findings);
  const score = Math.max(0, 100 - all.reduce((s, f) => s + WEIGHT[f.level], 0));
  const bad = all.filter((f) => f.level !== "ok").sort((a, b) => WEIGHT[b.level] - WEIGHT[a.level]);
  return {
    verdict: score >= 75 ? "SAFE" : score >= 45 ? "CAUTION" : "RISKY",
    score,
    headline: bad.length === 0 ? "No red flags found." : `${bad.length} thing(s) to watch.`,
    reasons: (bad.length ? bad : all).slice(0, 5).map((f) => `${f.title}. ${f.detail}`),
  };
}

export async function writeReport(token: Address, results: ServiceResult[]): Promise<Report> {
  const floor = ruleVerdict(results);
  if (!AI_ON) return floor;
  try {
    const { output } = await generateText({
      model: AI_MODEL,
      output: Output.object({ schema: report }),
      system:
        "You are a blunt crypto safety analyst. Write for a normal person about to buy a token. Use only the findings " +
        "given. Short sentences, no jargon, no financial advice language. Reasons are max 18 words each.",
      prompt:
        `Token ${token}. Rule-based score: ${floor.score}/100 (${floor.verdict}). Don't rate it safer than this.\n` +
        JSON.stringify(results.map(({ service, summary, findings }) => ({ service, summary, findings }))),
    });
    return output.score > floor.score ? { ...output, score: floor.score, verdict: floor.verdict } : output;
  } catch {
    return floor;
  }
}

// ------------------------------------------------------------------ the bad actor (demo)

/** Takes the money and returns something that looks like a result but isn't. */
export async function lazyScan(): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 400));
  return { service: "contract-scan", summary: "looks good 👍", findings: [] };
}
