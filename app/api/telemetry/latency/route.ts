import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Durable sink for the latency summaries the board already computes.
 *
 * Explicitly NOT behind guardProviderRequest. That guard reserves provider
 * spend, consumes a rate-limit bucket and can return 429/503 — all correct for
 * a call that costs money, all wrong for a metrics write that costs nothing.
 * Putting telemetry behind it would mean the sessions most worth measuring
 * (the ones hitting limits) are exactly the ones that fail to report.
 *
 * What is still enforced: authentication, ownership of the named session, and
 * a hard cap on rows per request. A caller cannot write rows for anyone else
 * and cannot use this endpoint as unbounded storage.
 */

const MAX_SAMPLES_PER_REQUEST = 20;

interface IncomingSummary {
  mode?: string;
  interimCount?: number;
  pressToListening?: number | null;
  pressToMicPermission?: number | null;
  pressToLeaseReady?: number | null;
  pressToTokenReady?: number | null;
  socketToFirstInterim?: number | null;
  lagP50?: number | null;
  lagP95?: number | null;
  lagMax?: number | null;
  renderP50?: number | null;
  paintP50?: number | null;
  paintP95?: number | null;
  finalLagP50?: number | null;
  interimLagP50?: number | null;
  interimLagP95?: number | null;
  chunkGapP50?: number | null;
  chunkGapP95?: number | null;
  firstVisibleWordMs?: number | null;
  speechToSpeculativeP50?: number | null;
  speechToScribeP50?: number | null;
  speechToStructureP50?: number | null;
  scribeRequestWaitP50?: number | null;
  scribeFirstOpP50?: number | null;
  chunkToMessageP50?: number | null;
  chunkToMessageP95?: number | null;
  chunkToMessageMax?: number | null;
  speechOnsetToRawInterimP50?: number | null;
  speechOnsetToRawInterimP95?: number | null;
  chunkToInkP50?: number | null;
  chunkToInkP95?: number | null;
  chunkToInkMax?: number | null;
  /** Raw per-utterance traces — see lib/latency.ts's DiagnosticTraces. Not
   * ms values, so not run through ms() below; validated by shape instead. */
  traces?: unknown;
}

/** Loose shape-check only — this is diagnostic and temporary, and a
 * malformed trace should be dropped rather than reject the whole write. */
function validTraces(value: unknown): value is { first: unknown; worst: unknown } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const okList = (x: unknown) => x === null || Array.isArray(x);
  return okList(v.first) && okList(v.worst);
}

/**
 * A measurement or nothing.
 *
 * Anything non-finite, negative, or absurd becomes null rather than a clamped
 * number, because a wrong measurement in this table is worse than a missing
 * one — it would silently move a percentile. The ceiling is an hour, which no
 * real span on this path can legitimately exceed.
 */
function ms(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 3_600_000) return null;
  return rounded;
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "Sign in to continue." } },
      { status: 401 },
    );
  }

  let body: { samples?: IncomingSummary[] };
  try {
    body = (await request.json()) as { samples?: IncomingSummary[] };
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }

  const samples = Array.isArray(body.samples) ? body.samples.slice(0, MAX_SAMPLES_PER_REQUEST) : [];
  if (!samples.length) return NextResponse.json({ written: 0 });

  const sessionId = request.headers.get("x-inpublic-session-id");
  const admin = createAdminClient();

  // Attribute to a session only when the caller actually owns it. An
  // unrecognised or someone else's id degrades to a null session_id rather
  // than rejecting the write: the measurement is still true and still the
  // caller's own, it just loses its session grouping.
  let ownedSessionId: string | null = null;
  if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
    const { data } = await admin
      .from("usage_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    ownedSessionId = data?.id ?? null;
  }

  const rows = samples.map((sample) => ({
    user_id: user.id,
    session_id: ownedSessionId,
    mode: sample.mode === "story" ? "story" : "standard",
    interim_count: Math.max(0, Math.min(100_000, Math.round(Number(sample.interimCount) || 0))),
    press_to_listening_ms: ms(sample.pressToListening),
    press_to_mic_permission_ms: ms(sample.pressToMicPermission),
    press_to_lease_ready_ms: ms(sample.pressToLeaseReady),
    press_to_token_ready_ms: ms(sample.pressToTokenReady),
    socket_to_first_interim_ms: ms(sample.socketToFirstInterim),
    lag_p50_ms: ms(sample.lagP50),
    lag_p95_ms: ms(sample.lagP95),
    lag_max_ms: ms(sample.lagMax),
    render_p50_ms: ms(sample.renderP50),
    paint_p50_ms: ms(sample.paintP50),
    paint_p95_ms: ms(sample.paintP95),
    final_lag_p50_ms: ms(sample.finalLagP50),
    interim_lag_p50_ms: ms(sample.interimLagP50),
    interim_lag_p95_ms: ms(sample.interimLagP95),
    chunk_gap_p50_ms: ms(sample.chunkGapP50),
    chunk_gap_p95_ms: ms(sample.chunkGapP95),
    first_visible_word_ms: ms(sample.firstVisibleWordMs),
    speech_to_speculative_p50_ms: ms(sample.speechToSpeculativeP50),
    speech_to_scribe_p50_ms: ms(sample.speechToScribeP50),
    speech_to_structure_p50_ms: ms(sample.speechToStructureP50),
    scribe_request_wait_p50_ms: ms(sample.scribeRequestWaitP50),
    scribe_first_op_p50_ms: ms(sample.scribeFirstOpP50),
    chunk_to_message_p50_ms: ms(sample.chunkToMessageP50),
    chunk_to_message_p95_ms: ms(sample.chunkToMessageP95),
    chunk_to_message_max_ms: ms(sample.chunkToMessageMax),
    speech_onset_to_raw_interim_p50_ms: ms(sample.speechOnsetToRawInterimP50),
    speech_onset_to_raw_interim_p95_ms: ms(sample.speechOnsetToRawInterimP95),
    chunk_to_ink_p50_ms: ms(sample.chunkToInkP50),
    chunk_to_ink_p95_ms: ms(sample.chunkToInkP95),
    chunk_to_ink_max_ms: ms(sample.chunkToInkMax),
    traces: validTraces(sample.traces) ? sample.traces : null,
  }));

  const { error } = await admin.from("latency_samples").insert(rows);
  if (error) {
    console.warn("[telemetry/latency]", error.message);
    // In production this must never surface as a failure worth acting on —
    // the caller is fire-and-forget by design and the local copy already
    // landed, so a table outage should never be visible to a real session.
    // In development the whole point of this route is to prove telemetry
    // reaches the database, so a write that silently no-ops (wrong schema,
    // missing table, RLS rejection) needs to fail loudly instead of
    // returning the same {written:0} shape as "nothing to write".
    if (process.env.NODE_ENV === "development") {
      return NextResponse.json(
        { error: { code: "insert_failed", message: error.message } },
        { status: 500 },
      );
    }
    return NextResponse.json({ written: 0 });
  }
  return NextResponse.json({ written: rows.length });
}
