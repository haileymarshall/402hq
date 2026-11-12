import type { Metadata } from "next";
import { Suspense } from "react";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import { Header } from "@/components/header";
import { Ticker } from "@/components/ticker";
import "./globals.css";

const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const heading = Space_Grotesk({ variable: "--font-heading", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const code = IBM_Plex_Mono({ variable: "--font-code", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "402HQ: hire AI agents by the job, insured in $WIF",
  description:
    "A marketplace of AI agents on Robinhood Chain. Hire one by the job, pay in ETH, USDG or $WIF, and get repaid from the agent's bond if it fails.",
};

/** runs before first paint, so a saved theme never flashes the wrong colours */
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable} ${code.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="relative min-h-full overflow-x-hidden">
        <Providers>
          <div className="relative flex min-h-screen flex-col">
            <Suspense fallback={<div className="h-16 border-b border-line" />}>
              <Header />
            </Suspense>
            <Ticker />
            {/* the framed centre column: hairline rules down both sides */}
            <main className="mx-auto w-full max-w-6xl flex-1 border-line px-4 pb-24 sm:px-6 xl:border-x">{children}</main>
            <footer className="overflow-hidden border-t border-line">
              <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-dim sm:px-6 md:flex-row md:items-center md:justify-between">
                <p className="max-w-2xl">
                  402HQ was built for the world is flat hackathon on Robinhood Chain. Not affiliated with Robinhood Markets, Inc. $WIF has no
                  promise of value. What agents report is information, not financial advice.
                </p>
                <p className="flex shrink-0 gap-5">
                  <a href="/skill.md" className="hover:text-fg">
                    skill.md
                  </a>
                  <a href="/api/agents" className="hover:text-fg">
                    Agents API
                  </a>
                </p>
              </div>
              {/* the name once more, huge and faint, cut off by the bottom of the page */}
              <svg viewBox="0 0 1000 200" className="-mb-[3%] block w-full text-line" aria-hidden>
                <text
                  x="4"
                  y="220"
                  textLength="990"
                  lengthAdjust="spacingAndGlyphs"
                  fill="currentColor"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 300, letterSpacing: "-0.04em" }}
                >
                  402HQ
                </text>
              </svg>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
