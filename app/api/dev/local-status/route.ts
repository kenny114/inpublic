import { NextResponse } from "next/server";
import { getRemoteCallCount, OLLAMA_MODEL } from "@/lib/llm";

export const dynamic = "force-dynamic";

/**
 * Local-development-only status for the offline indicator
 * (components/LocalStatusBadge.tsx). Absent in production (404) — mirrors
 * app/api/dev/replay-authorization/route.ts's dev-only gate. Server env vars
 * (LLM_PROVIDER, OLLAMA_MODEL) are not NEXT_PUBLIC_-prefixed, so this route
 * is the only way the client badge can see which provider is actually live.
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(
    {
      llmProvider: process.env.LLM_PROVIDER || "anthropic",
      ollamaModel: OLLAMA_MODEL,
      speechEngine: process.env.NEXT_PUBLIC_ENGINE || "deepgram",
      remoteCallCount: getRemoteCallCount(),
    },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
