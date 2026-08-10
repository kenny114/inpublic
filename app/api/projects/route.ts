import { NextResponse } from "next/server";
import { createServerSupabaseClient, getAuthenticatedUser } from "@/lib/supabase/server";

const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
function publicProject(row: Record<string, unknown>) {
  return { ...(row.canvas_json as Record<string, unknown>), id: row.id, title: row.title, mode: row.mode, log: row.transcript_json, savedAt: new Date(String(row.updated_at)).getTime(), cloudUpdatedAt: row.updated_at };
}

export async function GET() {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const { data, error } = await (await createServerSupabaseClient()).from("projects").select("id,title,mode,canvas_json,transcript_json,updated_at,last_opened_at").is("deleted_at", null).order("updated_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: { code: "projects_unavailable", message: "Projects could not be loaded." } }, { status: 503 });
  return NextResponse.json({ projects: (data ?? []).map((row) => publicProject(row)) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_PAYLOAD_BYTES) return NextResponse.json({ error: { code: "payload_too_large", message: "This project is too large to sync." } }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: { code: "invalid_request", message: "Invalid project." } }, { status: 400 }); }
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : crypto.randomUUID();
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Untitled visual session";
  const mode = body.mode === "story" ? "story" : "standard";
  const { log, cloudUpdatedAt: _cloudUpdatedAt, savedAt: _savedAt, userId: _ignoredUserId, ...canvas } = body;
  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase.from("projects").select("id").eq("id", id).maybeSingle();
  if (existing) return NextResponse.json({ error: { code: "project_exists", message: "The project already exists." } }, { status: 409 });
  const { data, error } = await supabase.from("projects").insert({ id, user_id: user.id, title, mode, canvas_json: canvas, transcript_json: Array.isArray(log) ? log : [] }).select("id,title,mode,canvas_json,transcript_json,updated_at").single();
  if (error || !data) return NextResponse.json({ error: { code: "save_failed", message: "The cloud save failed. Your local copy is safe." } }, { status: 503 });
  return NextResponse.json({ project: publicProject(data) }, { status: 201 });
}
