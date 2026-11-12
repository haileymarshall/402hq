import "server-only";
import { contractExplain, launchRadar, postWriter, priceFeed, txExplain, walletXray, whaleWatch } from "./extra";
import {
  contractScan,
  deployerProfile,
  holderAnalysis,
  lazyScan,
  liquidityCheck,
  parseAddress,
  parseToken,
  parseTx,
  serviceResult,
  writeReport,
} from "./services";

export type JobBody = { input?: unknown; token?: unknown; results?: unknown };

/** What each of our specialist agents does with a paid request. `input` is the token, wallet or transaction. */
export async function runService(slug: string, body: JobBody) {
  const input = body.input ?? body.token;
  switch (slug) {
    case "sentinel":
      return contractScan(parseToken(input));
    case "lazyscan":
      return lazyScan();
    case "census":
      return holderAnalysis(parseToken(input));
    case "depth":
      return liquidityCheck(parseToken(input));
    case "origin":
      return deployerProfile(parseToken(input));
    case "scribe":
      return writeReport(parseToken(input), serviceResult.array().parse(body.results));
    case "ticker":
      return priceFeed(parseToken(input));
    case "whalewatch":
      return whaleWatch(parseToken(input));
    case "radar":
      return launchRadar();
    case "xray":
      return walletXray(parseAddress(input, "a wallet address"));
    case "decoder":
      return txExplain(parseTx(input));
    case "blueprint":
      return contractExplain(parseAddress(input, "a contract address"));
    case "herald":
      return postWriter(parseToken(input));
    default:
      throw new Error(`unknown agent ${slug}`);
  }
}
