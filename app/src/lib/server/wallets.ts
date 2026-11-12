import "server-only";
import { createWalletClient, http, nonceManager, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { robinhood } from "../chain";

const transport = http(process.env.RPC_URL || robinhood.rpcUrls.default.http[0], { timeout: 30_000, retryCount: 6, retryDelay: 350 });

// lead agents hire several agents at once, so one shared account per key keeps nonces in order
const accounts = new Map<string, PrivateKeyAccount>();
function wallet(key: string | undefined) {
  if (!key) return null;
  if (!accounts.has(key)) accounts.set(key, privateKeyToAccount(key as Hex, { nonceManager }));
  return createWalletClient({ account: accounts.get(key)!, chain: robinhood, transport });
}

/** the lead agents' key: it can only spend through their AgentVaults, inside each vault's rules */
export const operator = wallet(process.env.OPERATOR_KEY);
/** the key allowed to refund failed jobs */
export const arbiter = wallet(process.env.ARBITER_KEY || process.env.OPERATOR_KEY);

/** each lead agent has its own on-chain wallet (an AgentVault), keyed by the agent's slug */
export const VAULTS: Record<string, Address | ""> = {
  guardian: (process.env.GUARDIAN_VAULT_ADDRESS || process.env.DESK_VAULT_ADDRESS || "") as Address | "",
  scout: (process.env.SCOUT_VAULT_ADDRESS || "") as Address | "",
};

/** payments are real only when the market, a vault and the operator are all configured */
export const PAYMENTS_ON = !!(process.env.NEXT_PUBLIC_MARKET_ADDRESS && VAULTS.guardian && operator);
