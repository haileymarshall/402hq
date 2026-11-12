"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import type { PayWith } from "@/lib/tx";
import { dollars, fmt, useMarket } from "@/lib/use-market";

/** Reads a server-sent-events body and hands each event over as it arrives. */
export async function readEvents<T>(res: Response, on: (e: T) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop()!;
    for (const p of parts) if (p.startsWith("data: ")) on(JSON.parse(p.slice(6)));
  }
}

export const errorText = (e: unknown) => (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "Something went wrong";

/** How the buyer pays. ETH is the default once the router is live: nothing to approve, and it settles in $WIF. */
export function usePayWith() {
  const { data } = useMarket();
  const [choice, setChoice] = useState<PayWith | null>(null);
  const ethOn = !!data?.ethOn;
  const how: PayWith = choice ?? (ethOn ? "eth" : "wif");
  return { how, setHow: setChoice, ethOn, live: !!data?.paymentsOn, rates: data?.rates };
}

export function PayToggle({ how, setHow, ethOn }: { how: PayWith; setHow: (h: PayWith) => void; ethOn: boolean }) {
  if (!ethOn) return null;
  return (
    <div className="inline-flex rounded-lg border border-line-2 p-0.5" role="radiogroup" aria-label="Pay with">
      {(["eth", "usdg", "wif"] as const).map((h) => (
        <button
          key={h}
          type="button"
          role="radio"
          aria-checked={how === h}
          onClick={() => setHow(h)}
          className={`cap rounded-lg px-3 py-1.5 transition ${how === h ? "bg-accent !text-ink" : "hover:!text-fg"}`}
        >
          {h === "eth" ? "ETH" : h === "usdg" ? "USDG" : "$WIF"}
        </button>
      ))}
    </div>
  );
}

/** "60 $WIF · about $0.07", with the ETH figure when the buyer pays in ETH */
export function PriceLine({ price, how }: { price: string | number; how?: PayWith }) {
  const { data } = useMarket();
  const usd = dollars(price, data?.rates.wifUsd);
  const eth = data?.rates.wifEth ? Number(price) * data.rates.wifEth : 0;
  const usdg = data?.rates.wifUsdg ? Number(price) * data.rates.wifUsdg : 0;
  return (
    <span className="num">
      {how === "eth" && eth ? (
        <>
          <b className="text-fg">{eth.toPrecision(3)} ETH</b>
          <span className="text-muted"> · settles as {fmt(price)} $WIF</span>
        </>
      ) : how === "usdg" && usdg ? (
        <>
          <b className="text-fg">{usdg.toFixed(2)} USDG</b>
          <span className="text-muted"> · settles as {fmt(price)} $WIF</span>
        </>
      ) : (
        <b className="text-fg">{fmt(price)} $WIF</b>
      )}
      {usd && <span className="text-muted"> · about {usd}</span>}
    </span>
  );
}

/** Wallet state for a hire button: in preview nobody needs a wallet; live, the buyer has to connect first. */
export function useBuyer(live: boolean) {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const needsWallet = mounted && live && !isConnected;
  return { needsWallet, connect: () => connectors[0] && connect({ connector: connectors[0] }) };
}
