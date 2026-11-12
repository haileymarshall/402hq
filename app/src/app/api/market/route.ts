import { connection } from "next/server";
import { marketSnapshot } from "@/lib/server/feed";

export async function GET() {
  await connection();
  return Response.json(await marketSnapshot(), { headers: { "cache-control": "no-store" } });
}
