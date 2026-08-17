import { NextResponse } from "next/server";
import { mintDevelopmentReplayAuthorization } from "@/lib/server/developmentReplayAuthorization";

export const dynamic = "force-dynamic";

/**
 * Local-development benchmark capability. This route is intentionally absent
 * semantically in production (404), never creates a usage row, and returns a
 * one-use token that expires after 30 seconds and is bound to this browser.
 */
export async function POST(request: Request) {
  const authorization = mintDevelopmentReplayAuthorization(request);
  if (!authorization) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(
    { authorization },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
