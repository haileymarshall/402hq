"use client";

import { erc20Abi, formatEther, maxUint256, parseUnits, type Address, type Hex } from "viem";
import { getAccount, readContract, simulateContract, switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { marketAbi, routerAbi } from "./abi";
import { MARKET, ROUTER, USDG, WIF, robinhood } from "./chain";
import { wagmiConfig } from "./wagmi";

async function ready() {
  const acc = getAccount(wagmiConfig);
  if (!acc.address) throw new Error("Connect your wallet first");
  if (acc.chainId !== robinhood.id) await switchChain(wagmiConfig, { chainId: robinhood.id });
  return acc.address;
}

async function send(pending: Promise<Hex>) {
  const hash = await pending;
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/** approve the market once (unlimited), so later jobs are a single transaction */
async function ensureAllowance(owner: Address, amount: bigint, onStep?: (s: string) => void) {
  const allowance = await readContract(wagmiConfig, {
    address: WIF,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, MARKET as Address],
  });
  if (allowance >= amount) return;
  onStep?.("Approve $WIF in your wallet");
  await send(writeContract(wagmiConfig, { address: WIF, abi: erc20Abi, functionName: "approve", args: [MARKET as Address, maxUint256] }));
}

export async function payJob(agentId: number, price: string, jobId: `0x${string}`, onStep?: (s: string) => void) {
  const me = await ready();
  const amount = parseUnits(price, 18);
  await ensureAllowance(me, amount, onStep);
  onStep?.(`Pay ${price} $WIF in your wallet`);
  return send(writeContract(wagmiConfig, { address: MARKET as Address, abi: marketAbi, functionName: "pay", args: [BigInt(agentId), jobId, amount] }));
}

/** what a job costs in ETH right now, straight from the router (the swap inside is simulated, never sent) */
export async function quoteEth(agentId: number) {
  const { result } = await simulateContract(wagmiConfig, {
    address: ROUTER as Address,
    abi: routerAbi,
    functionName: "quoteJob",
    args: [BigInt(agentId)],
  });
  return { price: result[0], ethIn: result[1] };
}

/**
 * Pay for a job in ETH. The router buys exactly the job's price in $WIF and settles it in the same transaction.
 * We send 3% more than the quote in case the price moves; the router returns whatever it doesn't spend.
 */
export async function payJobEth(agentId: number, price: string, jobId: `0x${string}`, onStep?: (s: string) => void) {
  await ready();
  onStep?.("Getting a price in ETH");
  const { ethIn } = await quoteEth(agentId);
  const value = (ethIn * 103n) / 100n;
  onStep?.(`Pay ${Number(formatEther(ethIn)).toPrecision(3)} ETH in your wallet`);
  return send(
    writeContract(wagmiConfig, {
      address: ROUTER as Address,
      abi: routerAbi,
      functionName: "payWithEth",
      args: [BigInt(agentId), jobId, parseUnits(price, 18)],
      value,
    }),
  );
}

/**
 * Pay for a job in USDG. The router buys exactly the job's price in $WIF from the USDG/$WIF pool and settles it in
 * the same transaction. It may pull up to 3% over the quote if the price moves, and never more.
 */
export async function payJobUsdg(agentId: number, price: string, jobId: `0x${string}`, onStep?: (s: string) => void) {
  const me = await ready();
  onStep?.("Getting a price in USDG");
  const { result } = await simulateContract(wagmiConfig, {
    address: ROUTER as Address,
    abi: routerAbi,
    functionName: "quoteJobUsdg",
    args: [BigInt(agentId)],
  });
  const maxUsdg = (result[1] * 103n) / 100n;
  const allowance = await readContract(wagmiConfig, { address: USDG, abi: erc20Abi, functionName: "allowance", args: [me, ROUTER as Address] });
  if (allowance < maxUsdg) {
    onStep?.("Approve USDG in your wallet");
    await send(writeContract(wagmiConfig, { address: USDG, abi: erc20Abi, functionName: "approve", args: [ROUTER as Address, maxUint256] }));
  }
  onStep?.(`Pay ${(Number(result[1]) / 1e6).toFixed(2)} USDG in your wallet`);
  return send(
    writeContract(wagmiConfig, {
      address: ROUTER as Address,
      abi: routerAbi,
      functionName: "payWithUsdg",
      args: [BigInt(agentId), jobId, parseUnits(price, 18), maxUsdg],
    }),
  );
}

export type PayWith = "eth" | "usdg" | "wif";
export const payFor = (how: PayWith, agentId: number, price: string, jobId: `0x${string}`, onStep?: (s: string) => void) =>
  how === "eth" ? payJobEth(agentId, price, jobId, onStep) : how === "usdg" ? payJobUsdg(agentId, price, jobId, onStep) : payJob(agentId, price, jobId, onStep);

export async function stakeOn(agentId: number, amount: string, onStep?: (s: string) => void) {
  const me = await ready();
  const value = parseUnits(amount, 18);
  await ensureAllowance(me, value, onStep);
  onStep?.("Confirm the stake in your wallet");
  return send(writeContract(wagmiConfig, { address: MARKET as Address, abi: marketAbi, functionName: "stake", args: [BigInt(agentId), value] }));
}

export async function marketCall(
  functionName: "requestUnstake" | "unstake" | "claim",
  agentId: number,
) {
  await ready();
  return send(writeContract(wagmiConfig, { address: MARKET as Address, abi: marketAbi, functionName, args: [BigInt(agentId)] }));
}

export async function registerAgent(
  args: { service: string; endpoint: string; price: string; backerPct: number; payout: Address; bond: string },
  onStep?: (s: string) => void,
) {
  const me = await ready();
  const bond = parseUnits(args.bond, 18);
  await ensureAllowance(me, bond, onStep);
  onStep?.("Confirm the listing in your wallet");
  return send(writeContract(wagmiConfig, {
    address: MARKET as Address,
    abi: marketAbi,
    functionName: "registerAgent",
    args: [args.service, args.endpoint, parseUnits(args.price, 18), Math.round(args.backerPct * 100), args.payout, bond],
  }));
}

export async function readPosition(agentId: number, who: Address) {
  const [stake, reward, pos] = await Promise.all([
    readContract(wagmiConfig, { address: MARKET as Address, abi: marketAbi, functionName: "stakeOf", args: [BigInt(agentId), who] }),
    readContract(wagmiConfig, { address: MARKET as Address, abi: marketAbi, functionName: "pendingReward", args: [BigInt(agentId), who] }),
    readContract(wagmiConfig, { address: MARKET as Address, abi: marketAbi, functionName: "positions", args: [BigInt(agentId), who] }),
  ]);
  return { stake, reward, unlockAt: Number(pos[2]) };
}

export async function wifBalance(who: Address) {
  return readContract(wagmiConfig, { address: WIF, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}
