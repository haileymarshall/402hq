/**
 * Launches 402HQ on Robinhood Chain in one go:
 *   1. deploys AgentMarket and the PayRouter (pay in ETH through the v4 ETH/$WIF pool, or in USDG through the v3
 *      USDG/$WIF pool),
 *   2. lists all our agents, each with the bond from its profile,
 *   3. deploys a vault for each lead agent (Guardian, Scout) and funds it,
 *   4. writes the env vars the app needs to app/.env.seed.local and prints them.
 *
 *   PRIVATE_KEY=0x… APP_URL=https://402hq.xyz RPC_URL=… pnpm seed
 *
 * Re-running is safe: pass MARKET_ADDRESS / ROUTER_ADDRESS to reuse what was deployed, agents already listed on that
 * market are skipped, and vaults already in GUARDIAN_VAULT_ADDRESS / SCOUT_VAULT_ADDRESS are reused.
 *
 * Optional: OPERATOR_ADDRESS and ARBITER_ADDRESS (default: the deployer), MIN_BOND (250), DISPUTE_WINDOW (6 h),
 * COOLDOWN (12 h), VAULT_FUNDS (2,500 per lead).
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, encodeDeployData, erc20Abi, http, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { marketAbi, routerAbi, vaultAbi } from "../src/lib/abi.ts";
import { PROFILES } from "../src/lib/catalog.ts";
import { POOL_MANAGER, WIF, WIF_POOL, robinhood } from "../src/lib/chain.ts";

/** the USDG/$WIF Uniswap v3 pool (token0 $WIF, token1 USDG, 1% fee) */
const USDG_POOL: Address = "0xc3A41A216afE024cf9F38a01C67E80De8916802c";

const env = (k: string, d?: string) => {
  const v = process.env[k] || d;
  if (v === undefined) throw new Error(`set ${k}`);
  return v;
};
const wif = (n: string | number) => parseUnits(String(n), 18);
const fmt = (v: bigint) => (v / 10n ** 18n).toLocaleString();

const account = privateKeyToAccount(env("PRIVATE_KEY") as Hex);
const transport = http(env("RPC_URL", robinhood.rpcUrls.default.http[0]), { retryCount: 6, retryDelay: 500 });
const pub = createPublicClient({ chain: robinhood, transport });
const wallet = createWalletClient({ account, chain: robinhood, transport });
const appUrl = env("APP_URL").replace(/\/$/, "");
const operator = env("OPERATOR_ADDRESS", account.address) as Address;
const arbiter = env("ARBITER_ADDRESS", account.address) as Address;
const vaultFunds = wif(env("VAULT_FUNDS", "2500"));
const code = JSON.parse(fs.readFileSync(new URL("bytecode.json", import.meta.url), "utf8")) as { market: Hex; vault: Hex; router: Hex };

async function wait(hash: Hex, what: string) {
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`${what} reverted: ${hash}`);
  console.log(`  ✓ ${what}  ${robinhood.blockExplorers.default.url}/tx/${hash}`);
  return r;
}

// ------------------------------------------------------------------ budget check

const leads = PROFILES.filter((p) => p.team);
const bonds = PROFILES.reduce((s, p) => s + wif(p.bond), 0n);
const need = bonds + vaultFunds * BigInt(leads.length);
const [have, eth] = await Promise.all([
  pub.readContract({ address: WIF, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  pub.getBalance({ address: account.address }),
]);
console.log(`deployer ${account.address}`);
console.log(`  ${fmt(have)} WIF (needs ${fmt(need)}: ${fmt(bonds)} in bonds + ${fmt(vaultFunds)} per lead vault), ${Number(eth) / 1e18} ETH`);

// ------------------------------------------------------------------ market

let market = process.env.MARKET_ADDRESS as Address | undefined;
let deployBlock = BigInt(process.env.MARKET_DEPLOY_BLOCK || "0");
if (!market) {
  if (have < need) throw new Error("not enough $WIF for bonds and vaults");
  const r = await wait(
    await wallet.deployContract({
      abi: marketAbi,
      bytecode: code.market,
      args: [WIF, wif(env("MIN_BOND", "250")), BigInt(env("DISPUTE_WINDOW", String(6 * 3600))), BigInt(env("COOLDOWN", String(12 * 3600))), arbiter],
    }),
    "deploy AgentMarket",
  );
  market = r.contractAddress!;
  deployBlock = r.blockNumber;
}
console.log(`AgentMarket ${market}`);

// ------------------------------------------------------------------ router

let router = process.env.ROUTER_ADDRESS as Address | undefined;
if (!router) {
  const r = await wait(
    await wallet.sendTransaction({
      data: encodeDeployData({ abi: routerAbi, bytecode: code.router, args: [market, POOL_MANAGER, WIF_POOL, USDG_POOL] }),
    }),
    "deploy PayRouter (ETH + USDG)",
  );
  router = r.contractAddress!;
}
console.log(`PayRouter ${router}`);

// ------------------------------------------------------------------ agents

const allowance = await pub.readContract({ address: WIF, abi: erc20Abi, functionName: "allowance", args: [account.address, market] });
if (allowance < bonds) {
  await wait(await wallet.writeContract({ address: WIF, abi: erc20Abi, functionName: "approve", args: [market, bonds] }), "approve bonds");
}

// agents are listed in catalog order, so anything already on this market is the start of that list
const listed = Number(await pub.readContract({ address: market, abi: marketAbi, functionName: "agentCount" }));
if (listed > 0) console.log(`  ${listed} agents already listed, continuing from there`);
for (const p of PROFILES.slice(listed)) {
  await wait(
    await wallet.writeContract({
      address: market,
      abi: marketAbi,
      functionName: "registerAgent",
      args: [p.service, `${appUrl}/api/agents/${p.slug}`, wif(p.price), 2_000, account.address, wif(p.bond)],
    }),
    `list ${p.name} (${p.price} WIF a job, ${p.bond} WIF bond)`,
  );
}

// ------------------------------------------------------------------ lead agents' vaults

// a lead may spend up to its funds in a day, at most 60 WIF on any one hire, and only on agents with at least a
// minimum bond behind them and a fail rate of 30% or less
const rules = { dailyCap: vaultFunds, perJobCap: wif(60), minSellerBacking: wif(env("MIN_BOND", "250")), maxSellerFailBps: 3_000 };
const vaults: Record<string, Address> = {};
for (const p of leads) {
  const key = `${p.slug.toUpperCase()}_VAULT_ADDRESS`;
  let vault = process.env[key] as Address | undefined;
  if (!vault) {
    vault = (await wait(await wallet.deployContract({ abi: vaultAbi, bytecode: code.vault, args: [market, account.address, operator, rules] }), `deploy ${p.name}'s vault`))
      .contractAddress!;
  }
  const balance = await pub.readContract({ address: WIF, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
  if (balance < vaultFunds) {
    await wait(await wallet.writeContract({ address: WIF, abi: erc20Abi, functionName: "transfer", args: [vault, vaultFunds - balance] }), `fund ${p.name}'s vault`);
  }
  vaults[key] = vault;
}

// ------------------------------------------------------------------ env

const out = [
  `NEXT_PUBLIC_MARKET_ADDRESS=${market}`,
  `NEXT_PUBLIC_MARKET_DEPLOY_BLOCK=${deployBlock}`,
  `NEXT_PUBLIC_ROUTER_ADDRESS=${router}`,
  ...Object.entries(vaults).map(([k, v]) => `${k}=${v}`),
].join("\n");
fs.writeFileSync(new URL("../.env.seed.local", import.meta.url), out + "\n");
console.log(`
Written to app/.env.seed.local. Add these to app/.env.local and to Vercel, plus OPERATOR_KEY (key of ${operator})
and ARBITER_KEY (key of ${arbiter}):
${out}
`);
