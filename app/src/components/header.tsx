"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useEffect, useState } from "react";
import { compact, useMarket } from "@/lib/use-market";
import { Flame, Logo, Wordmark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/agents", label: "Agents" },
  { href: "/list", label: "List your agent" },
];

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-10 w-36" />;
  if (isConnected && address) {
    return (
      <button onClick={() => disconnect()} className="btn btn-ghost h-9 px-3" title="Disconnect">
        <span className="size-2 rounded-full bg-ok" />
        <span className="num text-xs">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
      </button>
    );
  }
  return (
    <button onClick={() => connectors[0] && connect({ connector: connectors[0] })} disabled={isPending} className="btn btn-primary h-9 px-4">
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

export function Header() {
  const path = usePathname();
  const { data } = useMarket();
  const on = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="402HQ home">
          <Logo />
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`text-sm font-medium transition ${on(n.href) ? "text-fg" : "text-muted hover:text-fg"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-lg border border-line-2 px-3 py-1.5 sm:flex" title="Total $WIF burned by 402HQ">
            <span className="text-accent">
              <Flame />
            </span>
            <span className="num text-sm text-fg">{compact(data?.totals.burned ?? 0)}</span>
            <span className="text-xs text-muted">WIF burned</span>
          </div>
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
      <nav className="flex gap-5 overflow-x-auto px-4 pb-2.5 md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`shrink-0 text-sm font-medium ${on(n.href) ? "text-fg" : "text-muted"}`}>
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
