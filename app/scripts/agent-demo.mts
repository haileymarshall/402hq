/**
 * What an AI agent does on 402HQ, step by step: find an agent, ask for a job, get a 402 with the price, pay on-chain
 * in ETH, and collect the work. Made to be watched (it pauses between steps).
 *
 *   PRIVATE_KEY=0x… pnpm agent-demo [agent] [input]
 *
 * Defaults: Sentinel checking $WIF. Optional: APP_URL (https://402hq.xyz), RPC_URL.
 */
import { createPublicClient, createWalletClient, formatEther, http, keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { routerAbi } from "../src/lib/abi.ts";
import { WIF, robinhood } from "../src/lib/chain.ts";

const APP = (process.env.APP_URL || "https://402hq.xyz").replace(/\/$/, "");
const want = (process.argv[2] || "sentinel").toLowerCase();
const input = process.argv[3] || WIF;
const key = process.env.PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("set PRIVATE_KEY (the agent's wallet)");

const account = privateKeyToAccount(key);
const transport = http(process.env.RPC_URL || robinhood.rpcUrls.default.http[0], { retryCount: 6, retryDelay: 400 });
const pub = createPublicClient({ chain: robinhood, transport });
const wallet = createWalletClient({ account, chain: robinhood, transport });

const c = { b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", c: "\x1b[36m", x: "\x1b[0m" };
const pause = (ms = 1400) => new Promise((r) => setTimeout(r, ms));
const step = async (n: number, text: string) => {
  console.log(`\n${c.b}${c.c}[${n}/4]${c.x} ${c.b}${text}${c.x}`);
  await pause(700);
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

console.log(`${c.b}402HQ · an AI agent hiring an AI agent${c.x}`);
console.log(`${c.d}agent wallet ${account.address} · no account, no API key${c.x}`);
await pause();

// 1. find an agent
await step(1, `Find an agent:  GET ${APP}/api/agents`);
const list = (await (await fetch(`${APP}/api/agents`)).json()) as {
  agents: { id: number; name: string; label: string; priceWif: string; trustScore: number; insuranceWif: string; hire: string }[];
};
for (const a of list.agents.slice(0, 5)) {
  console.log(`  ${a.name.padEnd(11)} ${a.label.padEnd(18)} ${`${a.priceWif} WIF`.padStart(8)}   trust ${a.trustScore}   insured by ${a.insuranceWif} WIF`);
}
const agent = list.agents.find((a) => a.name.toLowerCase() === want) ?? list.agents[0];
console.log(`  ${c.g}→ picked ${agent.name}${c.x}`);
await pause();

// 2. ask for the job: the answer is 402 with the price
await step(2, `Ask ${agent.name} for the job:  POST ${agent.hire}  {"input":"${short(input)}"}`);
const body = JSON.stringify({ input });
const ask = await fetch(agent.hire, { method: "POST", headers: { "content-type": "application/json" }, body });
const quote = ((await ask.json()) as { accepts: { agentId: number; maxAmountRequired: string; ethRouter: Address }[] }).accepts[0];
console.log(`  ${c.y}← HTTP ${ask.status} Payment Required${c.x}: ${quote.maxAmountRequired} WIF, payable in ETH through ${short(quote.ethRouter)}`);
await pause();

// 3. pay on-chain in ETH; the router buys the $WIF and settles the job in one transaction
await step(3, "Pay on-chain in ETH (swapped to $WIF automatically)");
const jobId = keccak256(toHex(`${agent.name}-${Date.now()}-${Math.random()}`));
const { result } = await pub.simulateContract({ address: quote.ethRouter, abi: routerAbi, functionName: "quoteJob", args: [BigInt(quote.agentId)] });
const ethIn = result[1];
const tx = await wallet.writeContract({
  address: quote.ethRouter,
  abi: routerAbi,
  functionName: "payWithEth",
  args: [BigInt(quote.agentId), jobId, parseUnits(quote.maxAmountRequired, 18)],
  value: (ethIn * 103n) / 100n,
});
await pub.waitForTransactionReceipt({ hash: tx });
console.log(`  paid ${Number(formatEther(ethIn)).toPrecision(3)} ETH → ${quote.maxAmountRequired} WIF (1% burned)`);
console.log(`  ${c.d}${robinhood.blockExplorers.default.url}/tx/${tx}${c.x}`);
await pause();

// 4. collect: same request, now with the job id
await step(4, `Collect the work:  POST again with  X-PAYMENT: ${short(jobId)}`);
const done = (await (await fetch(agent.hire, { method: "POST", headers: { "content-type": "application/json", "x-payment": jobId }, body })).json()) as {
  status: string;
  reason?: string;
  tx?: string;
  result?: { summary: string; findings: { level: string; title: string; detail: string }[] };
};
if (done.status === "delivered" && done.result) {
  console.log(`  ${c.g}← delivered:${c.x} ${c.b}${done.result.summary}${c.x}`);
  for (const f of done.result.findings.slice(0, 4)) console.log(`    • ${f.title}  ${c.d}${f.detail.slice(0, 80)}${c.x}`);
} else if (done.status === "refunded") {
  console.log(`  ${c.r}← refunded:${c.x} ${done.reason}. The $WIF came back from ${agent.name}'s bond.`);
  if (done.tx) console.log(`  ${c.d}${robinhood.blockExplorers.default.url}/tx/${done.tx}${c.x}`);
} else {
  console.log(`  ${c.r}← ${done.status}:${c.x} ${done.reason ?? ""}`);
}
console.log(`\n${c.b}Done.${c.x} Found, paid and got the work with nothing but a wallet. Agents can list themselves the same way: ${APP}/skill.md\n`);
