// Regenerates src/lib/abi.ts and scripts/bytecode.json from the Foundry build. Run after `forge build`.
import fs from "node:fs";

const out = new URL("../../contracts/out/", import.meta.url);
const market = JSON.parse(fs.readFileSync(new URL("AgentMarket.sol/AgentMarket.json", out)));
const vault = JSON.parse(fs.readFileSync(new URL("AgentVault.sol/AgentVault.json", out)));
const router = JSON.parse(fs.readFileSync(new URL("PayRouter.sol/PayRouter.json", out)));

fs.writeFileSync(
  new URL("../src/lib/abi.ts", import.meta.url),
  "// Generated from contracts/out by scripts/abi.mjs. Do not edit.\n" +
    `export const marketAbi = ${JSON.stringify(market.abi)} as const;\n` +
    `export const vaultAbi = ${JSON.stringify(vault.abi)} as const;\n` +
    `export const routerAbi = ${JSON.stringify(router.abi)} as const;\n`,
);
fs.writeFileSync(
  new URL("bytecode.json", import.meta.url),
  JSON.stringify({ market: market.bytecode.object, vault: vault.bytecode.object, router: router.bytecode.object }),
);
console.log("abi.ts written");
