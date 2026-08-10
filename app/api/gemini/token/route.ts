import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { guardProviderRequest, reconcileProviderCost } from "@/lib/server/provider-guard";

export const dynamic = "force-dynamic";

// Not exported: Next route modules may only export handlers and known config.
const LIVE_MODEL = process.env.LIVE_MODEL || "gemini-3.1-flash-live-preview";

/**
 * Mints a short-lived Gemini auth token so the browser can hold a Live API
 * socket without ever seeing the real key. Same principle as the Deepgram
 * token route.
 *
 * `expireTime` bounds how long the session may run — generous, because a take
 * is long and reconnects reuse the same token window. `newSessionExpireTime`
 * bounds how long it may be used to *start* a session, and is short.
 */
export async function GET(request: Request) {
  const guard = await guardProviderRequest(request, { feature: "gemini", provider: "google", model: LIVE_MODEL, audioSeconds: 45 });
  if (guard instanceof Response) return guard;
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    await reconcileProviderCost(guard, "failed", { actualCostUsd: 0 });
    return NextResponse.json(
      { error: { code: "provider_unavailable", message: "Live transcription is temporarily unavailable." } },
      { status: 500 },
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const token = await ai.authTokens.create({
      config: {
        // Reconnects during a long take each start a new session.
        uses: 1,
        expireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 45 * 1000).toISOString(),
      },
    });

    if (!token.name) throw new Error("no token returned");
    return NextResponse.json({ token: token.name, model: LIVE_MODEL });
  } catch (err) {
    await reconcileProviderCost(guard, "failed", { actualCostUsd: 0 });
    console.error("[gemini/token]", err);
    return NextResponse.json(
      { error: "Failed to mint Gemini token" },
      { status: 500 },
    );
  }
}
