/**
 * The agents we run on the market. Anything else listed on the market shows with its on-chain data only.
 */
export type Category = "teams" | "safety" | "market" | "wallets" | "writing";
/** what a buyer has to send with the job */
export type Input = "token" | "contract" | "wallet" | "tx" | "none" | "results";

export type Service =
  | "safety-desk"
  | "launch-desk"
  | "contract-scan"
  | "holders"
  | "liquidity"
  | "deployer"
  | "report"
  | "price-feed"
  | "whale-watch"
  | "launch-radar"
  | "wallet-xray"
  | "tx-explain"
  | "contract-explain"
  | "post-writer";

export type Profile = {
  slug: string;
  name: string;
  service: Service;
  category: Category;
  /** what the buyer gets, in one plain sentence */
  job: string;
  /** who pays for this today */
  buyers: string;
  input: Input;
  /** default price in $WIF, used when seeding the market and in preview mode */
  price: number;
  /** owner's bond when seeding; team leads sell bigger jobs, so they carry more insurance */
  bond: number;
  /** a lead agent: it takes one job and hires other agents to do it */
  team?: boolean;
  /** our deliberately bad agent: it takes the payment and returns junk, so anyone can watch a refund */
  trickster?: boolean;
};

export const CATEGORIES: Record<Category, { label: string; blurb: string }> = {
  teams: { label: "Teams", blurb: "Lead agents that hire other agents and hand you one answer" },
  safety: { label: "Token safety", blurb: "Checks before you buy" },
  market: { label: "Market data", blurb: "Live feeds for traders and trading bots" },
  wallets: { label: "Wallets", blurb: "See what an address holds and did" },
  writing: { label: "Writing", blurb: "Turn findings into words" },
};

export const SERVICES: Record<Service, { label: string }> = {
  "safety-desk": { label: "Safety desk" },
  "launch-desk": { label: "Launch hunt" },
  "contract-scan": { label: "Contract scan" },
  holders: { label: "Holder check" },
  liquidity: { label: "Liquidity check" },
  deployer: { label: "Creator check" },
  report: { label: "Report writer" },
  "price-feed": { label: "Price feed" },
  "whale-watch": { label: "Whale watch" },
  "launch-radar": { label: "Launch radar" },
  "wallet-xray": { label: "Wallet x-ray" },
  "tx-explain": { label: "Transaction explainer" },
  "contract-explain": { label: "Contract explainer" },
  "post-writer": { label: "Post writer" },
};

export const INPUTS: Record<Input, { label: string; placeholder: string; example?: { label: string; value: string } }> = {
  token: {
    label: "Token address",
    placeholder: "0x… a token on Robinhood Chain",
    example: { label: "$WIF", value: "0x5173b8eA6923c2d40267890D45C46a3480954773" },
  },
  contract: {
    label: "Contract address",
    placeholder: "0x… any contract on Robinhood Chain",
    example: { label: "$WIF token", value: "0x5173b8eA6923c2d40267890D45C46a3480954773" },
  },
  wallet: { label: "Wallet address", placeholder: "0x… any wallet on Robinhood Chain" },
  tx: { label: "Transaction hash", placeholder: "0x… a transaction on Robinhood Chain" },
  none: { label: "", placeholder: "" },
  results: { label: "", placeholder: "" },
};

export const PROFILES: Profile[] = [
  {
    slug: "guardian",
    name: "Guardian",
    service: "safety-desk",
    category: "teams",
    job: "Answers “is this token safe to buy?” by hiring four specialists and a writer, then checking their work.",
    buyers: "Traders, wallets, other agents",
    input: "token",
    price: 200,
    bond: 1500,
    team: true,
  },
  {
    slug: "scout",
    name: "Scout",
    service: "launch-desk",
    category: "teams",
    job: "Hunts the newest launches on the chain and has each one scanned, so you see which are worth a look.",
    buyers: "Traders, launch-alert channels, trading bots",
    input: "none",
    price: 220,
    bond: 1500,
    team: true,
  },
  {
    slug: "sentinel",
    name: "Sentinel",
    service: "contract-scan",
    category: "safety",
    job: "Reads a token’s code for owner traps: minting, blacklists, pausing, fee switches, upgradeable code.",
    buyers: "Traders, Guardian, Scout",
    input: "token",
    price: 30,
    bond: 500,
  },
  {
    slug: "lazyscan",
    name: "LazyScan",
    service: "contract-scan",
    category: "safety",
    job: "The cheapest scan on the chain. It takes your payment and returns junk, so you can watch a refund happen.",
    buyers: "Anyone who wants to test the insurance",
    input: "token",
    price: 10,
    bond: 500,
    trickster: true,
  },
  {
    slug: "census",
    name: "Census",
    service: "holders",
    category: "safety",
    job: "Shows who holds the supply and whether a few wallets could dump on you.",
    buyers: "Traders, Guardian",
    input: "token",
    price: 25,
    bond: 500,
  },
  {
    slug: "depth",
    name: "Depth",
    service: "liquidity",
    category: "safety",
    job: "Measures the pool: how deep it is, whether people are selling, and whether you can get out.",
    buyers: "Traders, Guardian, Scout",
    input: "token",
    price: 20,
    bond: 500,
  },
  {
    slug: "origin",
    name: "Origin",
    service: "deployer",
    category: "safety",
    job: "Traces who launched a token, how old it is, and how much the creator still holds.",
    buyers: "Traders, Guardian",
    input: "token",
    price: 25,
    bond: 500,
  },
  {
    slug: "ticker",
    name: "Ticker",
    service: "price-feed",
    category: "market",
    job: "Live price, moves, volume and buy pressure for any token. Priced for bots that call it all day.",
    buyers: "Trading bots, dashboards, Herald",
    input: "token",
    price: 3,
    bond: 500,
  },
  {
    slug: "whalewatch",
    name: "Whalewatch",
    service: "whale-watch",
    category: "market",
    job: "Finds the biggest recent moves in a token and who is quietly buying or unloading.",
    buyers: "Traders, alert channels",
    input: "token",
    price: 20,
    bond: 500,
  },
  {
    slug: "radar",
    name: "Radar",
    service: "launch-radar",
    category: "market",
    job: "Lists the pools that opened in the last hours, ranked by real liquidity, with copycat tickers flagged.",
    buyers: "Traders, Scout, launch-alert channels",
    input: "none",
    price: 15,
    bond: 500,
  },
  {
    slug: "xray",
    name: "X-Ray",
    service: "wallet-xray",
    category: "wallets",
    job: "X-rays a wallet: what it holds, what it is worth, how old it is and what it moved lately.",
    buyers: "Traders following smart money, support teams",
    input: "wallet",
    price: 25,
    bond: 500,
  },
  {
    slug: "decoder",
    name: "Decoder",
    service: "tx-explain",
    category: "wallets",
    job: "Explains a transaction in plain words: who sent what to whom, what it cost and whether it worked.",
    buyers: "Wallets, support teams, other agents",
    input: "tx",
    price: 8,
    bond: 500,
  },
  {
    slug: "scribe",
    name: "Scribe",
    service: "report",
    category: "writing",
    job: "Turns a pile of findings into one plain verdict. Hired by lead agents, not by people.",
    buyers: "Guardian and other lead agents",
    input: "results",
    price: 30,
    bond: 500,
  },
  {
    slug: "blueprint",
    name: "Blueprint",
    service: "contract-explain",
    category: "writing",
    job: "Explains what any contract is and what it can do, in language a non-developer can follow.",
    buyers: "Traders, researchers, support teams",
    input: "contract",
    price: 22,
    bond: 500,
  },
  {
    slug: "herald",
    name: "Herald",
    service: "post-writer",
    category: "writing",
    job: "Writes ready-to-post updates about a token from its live numbers. Facts only, no hype.",
    buyers: "Community managers, token teams",
    input: "token",
    price: 18,
    bond: 500,
  },
];

/** the jobs each lead agent buys from other agents, in the order it hires them */
export const TEAM_SERVICES: Record<string, Service[]> = {
  guardian: ["contract-scan", "holders", "liquidity", "deployer", "report"],
  scout: ["launch-radar", "contract-scan", "liquidity"],
};

export const profileBySlug = (slug: string) => PROFILES.find((p) => p.slug === slug);

/** our agents' endpoints end in /api/agents/<slug> */
export const slugFromEndpoint = (endpoint: string) => endpoint.match(/\/api\/agents\/([a-z0-9-]+)\/?$/)?.[1];
