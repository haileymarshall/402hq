import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { robinhood } from "./chain";

export const wagmiConfig = createConfig({
  chains: [robinhood],
  connectors: [injected()],
  transports: { [robinhood.id]: http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
