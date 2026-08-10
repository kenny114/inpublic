import { createClient } from "@deepgram/sdk";
import { NextResponse } from "next/server";
import { guardProviderRequest, reconcileProviderCost } from "@/lib/server/provider-guard";

export const dynamic = "force-dynamic";

const TTL_SECONDS = 60;

/**
 * Mints a short-lived Deepgram credential for the browser. The root key never
 * leaves the server.
 *
 * Preferred path is /auth/grant, which any key can call and which returns a
 * bearer access token. createProjectKey is the fallback — it needs a key with
 * `keys:write` (admin/owner), which most project keys don't have.
 */
export async function GET(request: Request) {
  const guard = await guardProviderRequest(request, { feature: "deepgram", provider: "deepgram", model: "nova-3", audioSeconds: 45 });
  if (guard instanceof Response) return guard;
  const rootKey = process.env.DEEPGRAM_API_KEY;
  if (!rootKey) {
    await reconcileProviderCost(guard, "failed", { actualCostUsd: 0 });
    return NextResponse.json(
      { error: { code: "provider_unavailable", message: "Transcription is temporarily unavailable." } },
      { status: 500 },
    );
  }

  const deepgram = createClient(rootKey);

  try {
    const { result, error } = await deepgram.auth.grantToken({
      ttl_seconds: TTL_SECONDS,
    });
    if (!error && result?.access_token) {
      return NextResponse.json({
        accessToken: result.access_token,
        expiresIn: result.expires_in,
      });
    }
    if (error) console.warn("[deepgram/token] grantToken failed", error);
  } catch (err) {
    console.warn("[deepgram/token] grantToken threw", err);
  }

  try {
    const { result: projects, error: projectsError } =
      await deepgram.manage.getProjects();
    if (projectsError) throw projectsError;

    const projectId = projects?.projects?.[0]?.project_id;
    if (!projectId) throw new Error("no Deepgram project on this key");

    const { result: key, error: keyError } =
      await deepgram.manage.createProjectKey(projectId, {
        comment: "inpublic ephemeral browser key",
        scopes: ["usage:write"],
        time_to_live_in_seconds: TTL_SECONDS,
      });
    if (keyError) throw keyError;

    return NextResponse.json({ key: key?.key, expiresIn: TTL_SECONDS });
  } catch (err) {
    await reconcileProviderCost(guard, "failed", { actualCostUsd: 0 });
    console.error("[deepgram/token]", err);
    return NextResponse.json(
      { error: "Failed to mint Deepgram credential" },
      { status: 500 },
    );
  }
}
