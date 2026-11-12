import { createPublicClient, defineChain, erc20Abi, http, type Address } from "viem";

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const WIF: Address = "0x5173b8eA6923c2d40267890D45C46a3480954773";
export const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const WETH: Address = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
/** Uniswap v4 on Robinhood Chain, and the main ETH/$WIF pool that jobs paid in ETH are routed through */
export const POOL_MANAGER: Address = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
export const WIF_POOL = {
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: WIF,
  fee: 0,
  tickSpacing: 200,
  hooks: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
} as const;
export const MARKET = (process.env.NEXT_PUBLIC_MARKET_ADDRESS || "") as Address | "";
/** PayRouter: lets a buyer pay in ETH; it buys the $WIF and settles the job in one transaction */
export const ROUTER = (process.env.NEXT_PUBLIC_ROUTER_ADDRESS || "") as Address | "";
export const MARKET_DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_MARKET_DEPLOY_BLOCK || "0");

/** true once the market is deployed and its address is configured */
export const LIVE = MARKET !== "";

export const publicClient = createPublicClient({
  chain: robinhood,
  // server code may use a private (e.g. Quicknode) endpoint
  // the public RPC answers 429 when it is busy; back off and try again rather than fail an agent's job
  transport: http(process.env.RPC_URL || robinhood.rpcUrls.default.http[0], { batch: true, timeout: 25_000, retryCount: 6, retryDelay: 350 }),
});

/**
 * Log queries go to their own endpoint. Quicknode caps eth_getLogs at 10,000 blocks (about 12 minutes of this
 * chain), while the agents and the ledger read logs over days, so by default they use the public RPC, which allows
 * wide ranges. Override with LOGS_RPC_URL.
 */
export const logsClient = createPublicClient({
  chain: robinhood,
  transport: http(process.env.LOGS_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", { batch: false, timeout: 30_000, retryCount: 6, retryDelay: 400 }),
});

export const txUrl = (hash: string) => `${robinhood.blockExplorers.default.url}/tx/${hash}`;
export const addressUrl = (a: string) => `${robinhood.blockExplorers.default.url}/address/${a}`;

export { erc20Abi };
