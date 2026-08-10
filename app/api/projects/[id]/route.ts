import { NextResponse } from "next/server";
import { createServerSupabaseClient, getAuthenticatedUser } from "@/lib/supabase/server";

const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
type RouteContext = { params: Promise<{ id: string }> };
function publicProject(row: Record<string, unknown>) {
  return { ...(row.canvas_json as Record<string, unknown>), id: row.id, title: row.title, mode: row.mode, log: row.transcript_json, savedAt: new Date(String(row.updated_at)).getTime(), cloudUpdatedAt: row.updated_at };
}

export async function GET(_request: Request, { params }: RouteContext) {
  if (!(await getAuthenticatedUser().catch(() => null))) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const { id } = await params;
  const { data } = await (await createServerSupabaseClient()).from("projects").select("id,title,mode,canvas_json,transcript_json,updated_at").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!data) return NextResponse.json({ error: { code: "not_found", message: "Project not found." } }, { status: 404 });
  return NextResponse.json({ project: publicProject(data) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request, { params }: RouteContext) {
  if (!(await getAuthenticatedUser().catch(() => null))) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_PAYLOAD_BYTES) return NextResponse.json({ error: { code: "payload_too_large", message: "This project is too large to sync." } }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: { code: "invalid_request", message: "Invalid project." } }, { status: 400 }); }
  const { id } = await params;
  const expected = typeof body.cloudUpdatedAt === "string" ? body.cloudUpdatedAt : null;
  const { log, cloudUpdatedAt: _cloud, savedAt: _saved, userId: _ignored, ...canvas } = body;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Untitled visual session";
  const mode = body.mode === "story" ? "story" : "standard";
  const supabase = await createServerSupabaseClient();
  if (!expected) return NextResponse.json({ error: { code: "save_conflict", message: "A cloud version is required for updates." } }, { status: 409 });
  let query = supabase.from("projects").update({ title, mode, canvas_json: canvas, transcript_json: Array.isArray(log) ? log : [], last_opened_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null);
  query = query.eq("updated_at", expected);
  const { data, error } = await query.select("id,title,mode,canvas_json,transcript_json,updated_at").maybeSingle();
  if (error) return NextResponse.json({ error: { code: "save_failed", message: "The cloud save failed. Your local copy is safe." } }, { status: 503 });
  if (!data) {
    const { data: cloud } = await supabase.from("projects").select("id,title,mode,canvas_json,transcript_json,updated_at").eq("id", id).maybeSingle();
    return NextResponse.json({ error: { code: "save_conflict", message: "A newer cloud version exists." }, cloud: cloud ? publicProject(cloud) : null }, { status: 409 });
  }
  return NextResponse.json({ project: publicProject(data) });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  if (!(await getAuthenticatedUser().catch(() => null))) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const { id } = await params;
  const { error } = await (await createServerSupabaseClient()).from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: { code: "delete_failed", message: "Project could not be deleted." } }, { status: 503 });
  return new NextResponse(null, { status: 204 });
}
