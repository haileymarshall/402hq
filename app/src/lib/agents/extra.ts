import { decodeEventLog, erc20Abi, formatEther, formatUnits, getAddress, parseAbiItem, toFunctionSelector, type Address, type Hex } from "viem";
import { generateText } from "ai";
import { marketAbi } from "../abi";
import { MARKET, POOL_MANAGER, USDG, WETH, WIF, publicClient, logsClient } from "../chain";
import { compact, mainPair, pairsFor, pct, price, usd, type DexPair } from "./dex";
import { SECONDS_PER_BLOCK, ago, blocksToHours, isDead, recentLogs, recentTransfers, short, slicedLogs, tokenBasics, tokenMeta, transferEvent, type TransferLog } from "./onchain";
import { AI_MODEL, AI_ON, type Finding, type ServiceResult } from "./services";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

/** Plain text from the model, or null when no AI key is set or the call fails. Every caller has a rule-based answer. */
async function ask(system: string, prompt: string) {
  if (!AI_ON) return null;
  try {
    const { text } = await generateText({ model: AI_MODEL, system, prompt });
    return text.trim() || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ Ticker: price feed

export async function priceFeed(token: Address): Promise<ServiceResult> {
  const [basics, pairs] = await Promise.all([tokenBasics(token), pairsFor([token])]);
  const main = mainPair(pairs, token);
  if (!main || !main.priceUsd) {
    return {
      service: "price-feed",
      summary: `${basics.symbol} has no trading pool on Robinhood Chain, so it has no price.`,
      findings: [{ level: "warn", title: "No price", detail: "No DEX pool lists this token." }],
    };
  }
  const p = Number(main.priceUsd);
  const liq = main.liquidity?.usd ?? 0;
  const vol = main.volume?.h24 ?? 0;
  const buys = main.txns?.h24?.buys ?? 0;
  const sells = main.txns?.h24?.sells ?? 0;
  const share = buys + sells === 0 ? 0 : Math.round((buys / (buys + sells)) * 100);
  const findings: Finding[] = [
    { level: "info", title: `Price ${price(p)}`, detail: `On ${main.dexId} ${(main.labels ?? []).join(" ")}, against ${main.quoteToken.symbol}.`.replace("  ", " ") },
    {
      level: "info",
      title: `${pct(main.priceChange?.h24)} in 24 hours`,
      detail: `${pct(main.priceChange?.h1)} in the last hour, ${pct(main.priceChange?.h6)} in six hours.`,
    },
    { level: "info", title: `${usd(vol)} traded in 24 hours`, detail: `${buys} buys and ${sells} sells. Buyers made ${share}% of the trades.` },
    {
      level: liq < 5_000 ? "warn" : "info",
      title: `${usd(liq)} liquidity`,
      detail: liq < 5_000 ? "Thin: a small trade moves the price a lot." : `Market cap about ${usd(main.marketCap ?? main.fdv ?? 0)}.`,
    },
  ];
  return {
    service: "price-feed",
    summary: `${basics.symbol} trades at ${price(p)}, ${pct(main.priceChange?.h24)} in 24 hours, with ${usd(liq)} of liquidity.`,
    findings,
    data: {
      symbol: basics.symbol,
      priceUsd: p,
      change: main.priceChange,
      volume24h: vol,
      liquidityUsd: liq,
      buys24h: buys,
      sells24h: sells,
      marketCap: main.marketCap ?? main.fdv,
      pool: main.url,
    },
  };
}

// ------------------------------------------------------------------ Whalewatch: whale watch

export async function whaleWatch(token: Address): Promise<ServiceResult> {
  const basics = await tokenBasics(token);
  const { logs, span, latest } = await recentTransfers(token, 300_000n);
  const hours = blocksToHours(span);
  const unit = (v: bigint) => Number(formatUnits(v, basics.decimals));
  const ofSupply = (v: bigint) => (basics.totalSupply === 0n ? 0 : Number((v * 1_000_000n) / basics.totalSupply) / 10_000);

  const moves = logs.filter((l) => l.args.from && l.args.to && l.args.value !== undefined && !isDead(l.args.from) && !isDead(l.args.to));
  if (moves.length === 0) {
    return {
      service: "whale-watch",
      summary: `No ${basics.symbol} moved between wallets in the last ${Math.round(hours)} hours.`,
      findings: [{ level: "info", title: "Quiet", detail: "No transfers in the window." }],
    };
  }

  const net = new Map<string, bigint>();
  for (const l of moves) {
    net.set(l.args.from!, (net.get(l.args.from!) ?? 0n) - l.args.value!);
    net.set(l.args.to!, (net.get(l.args.to!) ?? 0n) + l.args.value!);
  }
  const biggest = [...moves].sort((a, b) => (b.args.value! > a.args.value! ? 1 : -1)).slice(0, 5);
  const ranked = [...net.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1));
  const involved = [...new Set([...ranked.slice(0, 6), ...ranked.slice(-6)].map(([a]) => a))] as Address[];
  const codes = await Promise.all(involved.map((a) => publicClient.getCode({ address: a })));
  const contract = new Set(involved.filter((_, i) => codes[i] && codes[i] !== "0x").map((a) => a.toLowerCase()));
  const label = (a: string) =>
    a.toLowerCase() === POOL_MANAGER.toLowerCase() ? "the Uniswap pool" : contract.has(a.toLowerCase()) ? `contract ${short(a)}` : short(a);

  // wallets only: contracts are pools and routers, not whales
  const wallets = ranked.filter(([a]) => !contract.has(a.toLowerCase()));
  const buyer = wallets[0];
  const seller = wallets[wallets.length - 1];
  const top = biggest[0];
  const when = (l: TransferLog) => ago(Number(latest - l.blockNumber!) * SECONDS_PER_BLOCK);

  const findings: Finding[] = [
    {
      level: ofSupply(top.args.value!) > 1 ? "warn" : "info",
      title: `Biggest move: ${compact(unit(top.args.value!))} ${basics.symbol}`,
      detail: `${ofSupply(top.args.value!).toFixed(2)}% of supply, from ${label(top.args.from!)} to ${label(top.args.to!)}, ${when(top)} ago.`,
    },
  ];
  if (buyer && buyer[1] > 0n) {
    findings.push({
      level: "info",
      title: `Top buyer: ${short(buyer[0])}`,
      detail: `Up ${compact(unit(buyer[1]))} ${basics.symbol} (${ofSupply(buyer[1]).toFixed(2)}% of supply) after everything it sent and received.`,
    });
  }
  if (seller && seller[1] < 0n) {
    const out = -seller[1];
    findings.push({
      level: ofSupply(out) > 1 ? "warn" : "info",
      title: `Top seller: ${short(seller[0])}`,
      detail: `Down ${compact(unit(out))} ${basics.symbol} (${ofSupply(out).toFixed(2)}% of supply) in the window.`,
    });
  }
  findings.push({
    level: "info",
    title: `${moves.length} transfers by ${net.size} addresses`,
    detail: `In the last ${hours < 2 ? `${Math.round(hours * 60)} minutes` : `${Math.round(hours)} hours`}.`,
  });

  return {
    service: "whale-watch",
    summary: `The biggest ${basics.symbol} move was ${compact(unit(top.args.value!))} (${ofSupply(top.args.value!).toFixed(2)}% of supply), ${when(top)} ago.`,
    findings,
    data: {
      windowHours: hours,
      moves: biggest.map((l) => ({ from: l.args.from, to: l.args.to, amount: unit(l.args.value!), tx: l.transactionHash })),
      buyers: wallets.slice(0, 5).filter(([, v]) => v > 0n).map(([a, v]) => ({ address: a, net: unit(v) })),
      sellers: wallets.slice(-5).filter(([, v]) => v < 0n).map(([a, v]) => ({ address: a, net: unit(v) })).reverse(),
    },
  };
}

// ------------------------------------------------------------------ Radar: launch radar

const initializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);

export type Launch = {
  address: Address;
  symbol: string;
  name: string;
  ageMinutes: number;
  liquidityUsd: number;
  volumeUsd: number;
  change: number | null;
  buys: number;
  sells: number;
  /** how many new tokens share this ticker */
  sameTicker: number;
  url: string;
};

/** Pools opened against ETH on Uniswap v4 in the last hours, with live liquidity for each. */
export async function newLaunches() {
  const { logs, span, latest } = await recentLogs(60_000n, (fromBlock, toBlock) =>
    logsClient.getLogs({ address: POOL_MANAGER, event: initializeEvent, args: { currency0: ZERO }, fromBlock, toBlock }),
  );
  const born = new Map<string, bigint>();
  for (const l of logs) if (l.args.currency1) born.set(getAddress(l.args.currency1), l.blockNumber!);
  // newest first; DexScreener takes 30 addresses a call, so look at the latest 120
  const tokens = [...born.keys()].reverse().slice(0, 120) as Address[];
  const pairs = await pairsFor(tokens);

  const tickers = new Map<string, number>();
  const seen: { token: Address; pair: DexPair }[] = [];
  for (const t of tokens) {
    const pair = mainPair(pairs, t);
    if (!pair) continue;
    seen.push({ token: t, pair });
    const k = pair.baseToken.symbol.toLowerCase();
    tickers.set(k, (tickers.get(k) ?? 0) + 1);
  }
  const windowMinutes = blocksToHours(span) * 60;
  const age = ({ token, pair }: { token: Address; pair: DexPair }) =>
    pair.pairCreatedAt
      ? (Date.now() - pair.pairCreatedAt) / 60_000
      : (Number(latest - born.get(token)!) * SECONDS_PER_BLOCK) / 60;
  const launches: Launch[] = seen
    // an old token that only got a new side pool is not a launch
    .filter((x) => age(x) <= windowMinutes * 1.5)
    .map(({ token, pair }) => ({
      address: token,
      symbol: pair.baseToken.symbol.slice(0, 16),
      name: pair.baseToken.name.slice(0, 40),
      ageMinutes: Math.max(1, Math.round(age({ token, pair }))),
      liquidityUsd: pair.liquidity?.usd ?? 0,
      volumeUsd: pair.volume?.h24 ?? 0,
      change: pair.priceChange?.h24 ?? null,
      buys: pair.txns?.h24?.buys ?? 0,
      sells: pair.txns?.h24?.sells ?? 0,
      sameTicker: tickers.get(pair.baseToken.symbol.toLowerCase()) ?? 1,
      url: pair.url,
    }))
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  return { launches, opened: born.size, hours: blocksToHours(span), copycats: [...tickers.entries()].filter(([, n]) => n > 1) };
}

export async function launchRadar(): Promise<ServiceResult> {
  const { launches, opened, hours, copycats } = await newLaunches();
  const window = hours < 2 ? `${Math.round(hours * 60)} minutes` : `${hours.toFixed(1)} hours`;
  const real = launches.filter((l) => l.liquidityUsd >= 1_000);
  if (real.length === 0) {
    return {
      service: "launch-radar",
      summary: `${opened} pools opened in the last ${window}, and none has $1k of liquidity yet.`,
      findings: [{ level: "info", title: `${opened} new pools`, detail: "Nothing with real liquidity so far." }],
      data: { launches: [], opened, windowHours: hours },
    };
  }
  const top = real.slice(0, 8);
  const findings: Finding[] = [
    {
      level: "info",
      title: `${opened} pools opened in the last ${window}`,
      detail: `${real.length} of the newest have more than $1k of liquidity. Ranked by liquidity below.`,
    },
    ...top.slice(0, 5).map(
      (l): Finding => ({
        level: l.sameTicker > 1 ? "warn" : "info",
        title: `${l.symbol}: ${usd(l.liquidityUsd)} liquidity, ${ago(l.ageMinutes * 60)} old`,
        detail: `${l.buys} buys and ${l.sells} sells, ${usd(l.volumeUsd)} traded${l.sameTicker > 1 ? `. ${l.sameTicker} new tokens use this ticker` : ""}. ${l.address}`,
      }),
    ),
  ];
  if (copycats.length > 0) {
    findings.push({
      level: "warn",
      title: `Copycat tickers: ${[...copycats].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s.toUpperCase()} ×${n}`).join(", ")}`,
      detail: "Several new tokens share a name. At most one of each is the original.",
    });
  }
  return {
    service: "launch-radar",
    summary: `${opened} pools opened in the last ${window}. ${top[0].symbol} leads with ${usd(top[0].liquidityUsd)} of liquidity.`,
    findings,
    data: { launches: top, opened, windowHours: hours },
  };
}

// ------------------------------------------------------------------ X-Ray: wallet x-ray

export async function walletXray(wallet: Address): Promise<ServiceResult> {
  // every token transfer in or out of the wallet over roughly the last eight hours
  const side = (args: { from?: Address; to?: Address }) =>
    slicedLogs(300_000n, (fromBlock, toBlock) => logsClient.getLogs({ event: transferEvent, args, fromBlock, toBlock }));
  const [eth, nonce, code, received, sent] = await Promise.all([
    publicClient.getBalance({ address: wallet }),
    publicClient.getTransactionCount({ address: wallet }),
    publicClient.getCode({ address: wallet }),
    side({ to: wallet }),
    side({ from: wallet }),
  ]);
  const latest = received.latest;
  const hours = blocksToHours(received.span < sent.span ? received.span : sent.span);
  const logs = [...received.logs, ...sent.logs] as TransferLog[];

  const touched = new Map<string, number>();
  for (const l of logs) touched.set(getAddress(l.address), (touched.get(getAddress(l.address)) ?? 0) + 1);
  const tokens = [...new Set([WIF, USDG, WETH, ...[...touched.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a)])].slice(0, 40) as Address[];

  const [balances, meta, pairs] = await Promise.all([
    publicClient.multicall({
      contracts: tokens.map((address) => ({ address, abi: erc20Abi, functionName: "balanceOf" as const, args: [wallet] as const })),
    }),
    tokenMeta(tokens),
    pairsFor(tokens.slice(0, 30)),
  ]);
  const wifPair = mainPair(pairs, WIF);
  const ethUsd = wifPair?.priceUsd && wifPair.priceNative ? Number(wifPair.priceUsd) / Number(wifPair.priceNative) : 0;

  const holdings = tokens
    .map((t, i) => {
      const m = meta.get(t.toLowerCase());
      const raw = (balances[i].result as bigint | undefined) ?? 0n;
      if (!m || raw === 0n) return null;
      const amount = Number(formatUnits(raw, m.decimals));
      // a price from a pool with almost nothing in it means nothing
      const pool = mainPair(pairs, t);
      const p = t === USDG ? 1 : t === WETH ? ethUsd : (pool?.liquidity?.usd ?? 0) >= 1_000 ? Number(pool?.priceUsd ?? 0) : 0;
      return { token: t, symbol: m.symbol, amount, usd: amount * p };
    })
    .filter((h): h is NonNullable<typeof h> => h !== null)
    .sort((a, b) => b.usd - a.usd);
  const ethAmount = Number(formatEther(eth));
  const total = ethAmount * ethUsd + holdings.reduce((s, h) => s + h.usd, 0);
  const isContract = !!code && code !== "0x";
  const last = logs.reduce<TransferLog | null>((a, b) => (!a || b.blockNumber! > a.blockNumber! ? b : a), null);

  const findings: Finding[] = [
    {
      level: "info",
      title: `Holds about ${usd(total)}`,
      detail: `${ethAmount.toFixed(4)} ETH plus ${holdings.length} token${holdings.length === 1 ? "" : "s"} it holds or moved today. Tokens with no pool count as $0.`,
    },
    ...holdings.slice(0, 3).map(
      (h): Finding => ({ level: "info", title: `${compact(h.amount)} ${h.symbol}`, detail: h.usd > 0 ? `Worth about ${usd(h.usd)}.` : "No pool deep enough to price it." }),
    ),
    isContract
      ? { level: "warn", title: "This is a contract", detail: "It is code, not a personal wallet. It may be a pool, a vault or a bot." }
      : {
          level: nonce < 5 ? "warn" : "info",
          title: `Sent ${nonce} transaction${nonce === 1 ? "" : "s"}`,
          detail: nonce < 5 ? "A fresh wallet with almost no history." : "An established wallet.",
        },
    last
      ? {
          level: "info",
          title: `Last moved tokens ${ago(Number(latest - last.blockNumber!) * SECONDS_PER_BLOCK)} ago`,
          detail: `${logs.length} token transfers across ${touched.size} tokens in the last ${Math.round(hours)} hours.`,
        }
      : { level: "info", title: "No recent token moves", detail: `Nothing in or out in the last ${Math.round(hours)} hours.` },
  ];
  return {
    service: "wallet-xray",
    summary: `${short(wallet)} holds about ${usd(total)}${holdings[0] ? `, mostly ${holdings[0].usd > ethAmount * ethUsd ? holdings[0].symbol : "ETH"}` : " in ETH"}.`,
    findings,
    data: { wallet, isContract, eth: ethAmount, ethUsd, totalUsd: total, transactions: nonce, holdings: holdings.slice(0, 12) },
  };
}

// ------------------------------------------------------------------ Decoder: transaction explainer

const SEL = {
  transfer: toFunctionSelector("function transfer(address,uint256)"),
  approve: toFunctionSelector("function approve(address,uint256)"),
};
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export async function txExplain(hash: Hex): Promise<ServiceResult> {
  const [tx, receipt] = await Promise.all([
    publicClient.getTransaction({ hash }).catch(() => null),
    publicClient.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!tx || !receipt) throw new Error("no such transaction on Robinhood Chain");
  const [block, latest] = await Promise.all([publicClient.getBlock({ blockNumber: receipt.blockNumber }), publicClient.getBlockNumber()]);
  const sender = getAddress(tx.from);

  const transfers = receipt.logs
    .filter((l) => l.topics[0] === TRANSFER_TOPIC && l.topics.length === 3 && l.data.length >= 66)
    .map((l) => ({
      token: getAddress(l.address),
      from: getAddress(`0x${l.topics[1]!.slice(26)}`),
      to: getAddress(`0x${l.topics[2]!.slice(26)}`),
      value: BigInt(l.data.slice(0, 66)),
    }));
  const meta = await tokenMeta([...new Set(transfers.map((t) => t.token))]);
  const show = (token: Address, v: bigint) => {
    const m = meta.get(token.toLowerCase());
    return m ? `${compact(Number(formatUnits(v, m.decimals)))} ${m.symbol}` : `${v} of ${short(token)}`;
  };

  // what the sender ended up with, per token
  const delta = new Map<Address, bigint>();
  for (const t of transfers) {
    if (t.from === sender) delta.set(t.token, (delta.get(t.token) ?? 0n) - t.value);
    if (t.to === sender) delta.set(t.token, (delta.get(t.token) ?? 0n) + t.value);
  }
  const gained = [...delta.entries()].filter(([, v]) => v > 0n);
  const lost = [...delta.entries()].filter(([, v]) => v < 0n);
  const ok = receipt.status === "success";
  const who = short(sender);
  const sel = tx.input.slice(0, 10);

  let job: string | null = null;
  if (MARKET) {
    for (const l of receipt.logs) {
      if (l.address.toLowerCase() !== MARKET.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: marketAbi, data: l.data, topics: l.topics });
        if (ev.eventName === "JobPaid") job = `paid ${Number(formatEther(ev.args.amount))} $WIF for a job from agent #${ev.args.agentId} on 402HQ`;
        if (ev.eventName === "JobRefunded") job = `refunded ${Number(formatEther(ev.args.refunded))} $WIF for a failed job on 402HQ`;
      } catch {}
    }
  }

  let what: string;
  if (!ok) what = `${who} tried a transaction and it failed. Nothing moved, but the fee was still paid`;
  else if (job) what = `${who} ${job}`;
  else if (!tx.to) what = `${who} deployed a new contract at ${short(receipt.contractAddress ?? ZERO)}`;
  else if (gained.length > 0 && (lost.length > 0 || tx.value > 0n)) {
    const gave = lost.length > 0 ? lost.map(([t, v]) => show(t, -v)).join(" and ") : `${formatEther(tx.value)} ETH`;
    what = `${who} swapped ${gave} for ${gained.map(([t, v]) => show(t, v)).join(" and ")}`;
  } else if (sel === SEL.transfer && lost.length > 0) {
    what = `${who} sent ${show(lost[0][0], -lost[0][1])} to ${short(transfers.find((t) => t.from === sender)!.to)}`;
  } else if (sel === SEL.approve) what = `${who} allowed ${short(getAddress(`0x${tx.input.slice(34, 74)}`))} to spend its ${meta.get(tx.to.toLowerCase())?.symbol ?? "tokens"}`;
  else if (lost.length > 0) what = `${who} moved ${lost.map(([t, v]) => show(t, -v)).join(" and ")} into a contract, which is what a sale for ETH looks like`;
  else if (gained.length > 0) what = `${who} received ${gained.map(([t, v]) => show(t, v)).join(" and ")}`;
  else if (tx.value > 0n) what = `${who} sent ${formatEther(tx.value)} ETH to ${short(tx.to)}`;
  else if (transfers.length > 0) {
    // the sender's own balances didn't change, but the contract moved tokens between other wallets
    what = `${who} called contract ${short(tx.to)}, which made ${transfers.length} token transfer${transfers.length === 1 ? "" : "s"} between other wallets`;
  } else what = `${who} called contract ${short(tx.to)}, and no tokens moved`;

  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  const findings: Finding[] = [
    ok
      ? { level: "ok", title: "It succeeded", detail: `Confirmed in block ${receipt.blockNumber}, ${ago(Number(latest - receipt.blockNumber) * SECONDS_PER_BLOCK)} ago.` }
      : { level: "danger", title: "It failed", detail: "The transaction reverted. No tokens moved." },
    ...transfers.slice(0, 5).map((t): Finding => ({ level: "info", title: show(t.token, t.value), detail: `From ${short(t.from)} to ${short(t.to)}.` })),
    { level: "info", title: `Fee: ${Number(formatEther(fee)).toPrecision(3)} ETH`, detail: `Used ${receipt.gasUsed.toLocaleString("en-US")} gas.` },
  ];
  if (transfers.length > 5) findings.push({ level: "info", title: `${transfers.length - 5} more token moves`, detail: "Not listed here." });
  return {
    service: "tx-explain",
    summary: `${what}.`,
    findings,
    data: { from: sender, to: tx.to, success: ok, block: Number(receipt.blockNumber), time: Number(block.timestamp), valueEth: formatEther(tx.value), transfers: transfers.length },
  };
}

// ------------------------------------------------------------------ Blueprint: contract explainer

const ABILITIES: [signature: string, title: string, detail: string, level: Finding["level"], phrase: string][] = [
  ["function mint(address,uint256)", "Can create new tokens", "Someone with the right role can mint more supply.", "warn", "can mint new tokens"],
  ["function burn(uint256)", "Tokens can be burned", "Holders can destroy their own tokens, shrinking supply.", "info", "lets holders burn their tokens"],
  ["function pause()", "Can be paused", "An admin can freeze activity.", "warn", "can be paused"],
  ["function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", "Supports signed approvals", "Approvals can be given by signature, without a transaction.", "info", "accepts signed approvals"],
  ["function upgradeToAndCall(address,bytes)", "Upgradeable", "The code behind this address can be replaced.", "warn", "can be upgraded to new code"],
  ["function transferOwnership(address)", "Has an owner role", "One address holds admin rights and can hand them on.", "info", "has an owner role"],
  ["function stake(uint256)", "Takes stakes", "Users can lock tokens in it.", "info", "takes stakes"],
  ["function withdraw(uint256)", "Holds funds users can withdraw", "It keeps balances for its users.", "info", "holds funds for its users"],
  ["function multicall(bytes[])", "Batches calls", "Several actions can run in one transaction.", "info", "can batch several calls"],
  ["function swap(address,bool,int256,uint160,bytes)", "Is a trading pool", "It swaps one token for another.", "info", "swaps tokens"],
];
const KINDS: [signatures: string[], kind: string][] = [
  [["function ownerOf(uint256)", "function safeTransferFrom(address,address,uint256)"], "an NFT collection (ERC-721)"],
  [["function balanceOf(address,uint256)", "function safeTransferFrom(address,address,uint256,uint256,bytes)"], "a multi-token contract (ERC-1155)"],
  [["function transfer(address,uint256)", "function balanceOf(address)", "function totalSupply()"], "a token (ERC-20)"],
  [["function unlock(bytes)", "function settle()"], "the Uniswap v4 pool manager, which holds every v4 pool"],
];
const EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
/** a function exists if the code pushes its 4-byte selector (PUSH4 = 0x63) */
const has = (code: string, signature: string) => code.includes(`63${toFunctionSelector(signature).slice(2)}`);

export async function contractExplain(address: Address): Promise<ServiceResult> {
  const [code, impl, owner, name, symbol] = await Promise.all([
    publicClient.getCode({ address }),
    publicClient.getStorageAt({ address, slot: EIP1967_IMPL }),
    publicClient
      .readContract({ address, abi: [{ type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }], functionName: "owner" })
      .catch(() => null),
    publicClient.readContract({ address, abi: erc20Abi, functionName: "name" }).catch(() => null),
    publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
  ]);
  if (!code || code === "0x") {
    return {
      service: "contract-explain",
      summary: `${short(address)} is a plain wallet, not a contract. There is no code to explain.`,
      findings: [{ level: "info", title: "Not a contract", detail: "No code is stored at this address." }],
    };
  }
  const isProxy = !!impl && BigInt(impl) !== 0n;
  const kind = KINDS.find(([sigs]) => sigs.every((sig) => has(code, sig)))?.[1] ?? (isProxy ? "a proxy that forwards to other code" : "a custom contract");
  const abilities = ABILITIES.filter(([sig]) => has(code, sig));
  const renounced = owner !== null && isDead(owner);
  const label = name ? `${name}${symbol ? ` (${symbol})` : ""}` : short(address);

  const findings: Finding[] = [
    { level: "info", title: `It is ${kind}`, detail: `${((code.length - 2) / 2).toLocaleString("en-US")} bytes of code${name ? `, named ${label}` : ""}.` },
  ];
  if (isProxy) findings.push({ level: "warn", title: "Upgradeable proxy", detail: "This address forwards to code that can be swapped for new code." });
  findings.push(
    owner === null
      ? { level: "ok", title: "No owner", detail: "Nobody holds a general admin key." }
      : renounced
        ? { level: "ok", title: "Ownership given up", detail: "The owner role was renounced, so admin functions can't be called." }
        : { level: "warn", title: `Owned by ${short(owner)}`, detail: "This address can call the admin functions." },
  );
  for (const [, title, detail, level] of abilities) findings.push({ level, title, detail });
  if (abilities.length === 0 && !isProxy) findings.push({ level: "info", title: "No common admin powers found", detail: "It may still have custom functions we don't recognise." });

  const facts = findings.map((f) => `${f.title}: ${f.detail}`).join("\n");
  const written = await ask(
    "You explain smart contracts to people who don't code. Two or three short sentences, plain words, no jargon, no advice. Use only the facts given.",
    `Contract ${label} at ${address} on Robinhood Chain.\n${facts}`,
  );
  const powers = abilities.map((a) => a[4]).slice(0, 3);
  const list = powers.length > 1 ? `${powers.slice(0, -1).join(", ")} and ${powers[powers.length - 1]}` : powers[0];
  const fallback = `${label} is ${kind}. ${owner === null ? "Nobody owns it" : renounced ? "Its owner gave up control" : `It is controlled by ${short(owner)}`}${
    list ? `, and it ${list}` : ""
  }.`;
  return {
    service: "contract-explain",
    summary: written ?? fallback,
    findings,
    data: { address, kind, isProxy, owner, codeBytes: (code.length - 2) / 2, name, symbol },
  };
}

// ------------------------------------------------------------------ Herald: post writer

export async function postWriter(token: Address): Promise<ServiceResult> {
  const feed = await priceFeed(token);
  const d = feed.data as { symbol?: string; priceUsd?: number; change?: { h24?: number }; volume24h?: number; liquidityUsd?: number; buys24h?: number; sells24h?: number } | undefined;
  if (!d?.priceUsd) {
    return {
      service: "post-writer",
      summary: "There is no price for this token yet, so there is nothing true to post about it.",
      findings: [{ level: "warn", title: "Nothing to write", detail: "The token has no trading pool." }],
    };
  }
  const tag = `$${d.symbol}`;
  const posts = [
    `${tag} on Robinhood Chain: ${price(d.priceUsd)}, ${pct(d.change?.h24)} in 24h. ${usd(d.volume24h ?? 0)} traded, ${usd(d.liquidityUsd ?? 0)} of liquidity.`,
    `${d.buys24h ?? 0} buys and ${d.sells24h ?? 0} sells on ${tag} in the last 24 hours. Price ${price(d.priceUsd)} (${pct(d.change?.h24)}).`,
  ];
  const written = await ask(
    "You write X posts for a token community. Facts only: use the numbers given and nothing else. No hype words, no predictions, no advice, no emojis, no hashtags. " +
      "Return exactly three posts, each under 240 characters, one per line, no numbering.",
    `Token ${tag} on Robinhood Chain.\n${feed.findings.map((f) => `${f.title}. ${f.detail}`).join("\n")}`,
  );
  const lines = written?.split("\n").map((l) => l.trim()).filter((l) => l.length > 20 && l.length <= 280) ?? [];
  const final = lines.length >= 2 ? lines.slice(0, 3) : posts;
  return {
    service: "post-writer",
    summary: `${final.length} posts about ${tag}, written from its live numbers.`,
    findings: final.map((text, i): Finding => ({ level: "info", title: `Post ${i + 1}`, detail: text })),
    data: { posts: final, source: lines.length >= 2 ? "ai" : "template" },
  };
}
