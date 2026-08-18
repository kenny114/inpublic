import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TARGETS = {
  source: (extension: string) => `source-audio.${extension}`,
  video: (extension: string) => `video.${extension}`,
  session: () => "session.json",
  transcript: () => "transcript.txt",
  metadata: () => "metadata.json",
  thumbnail: () => "thumbnail.png",
} as const;

function safeExtension(value: string, fallback: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized || fallback;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const demoId = request.headers.get("x-demo-id") ?? "";
  const artifact = request.headers.get("x-artifact") as keyof typeof TARGETS | null;
  const chunkIndex = Number(request.headers.get("x-chunk-index"));
  const chunkCount = Number(request.headers.get("x-chunk-count"));
  if (!/^[a-f0-9-]{20,64}$/i.test(demoId) || !artifact || !(artifact in TARGETS)) return NextResponse.json({ error: "invalid_artifact" }, { status: 400 });
  if (!Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount) || chunkIndex < 0 || chunkCount < 1 || chunkIndex >= chunkCount) return NextResponse.json({ error: "invalid_chunk" }, { status: 400 });
  const root = path.resolve(process.cwd(), "artifacts", "demo-studio");
  const directory = path.resolve(root, `demo-${demoId}`);
  if (!directory.startsWith(`${root}${path.sep}`)) return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  await mkdir(directory, { recursive: true });
  const extension = safeExtension(request.headers.get("x-extension") ?? "", artifact === "video" ? "webm" : "audio");
  const filename = TARGETS[artifact](extension);
  const destination = path.join(directory, filename);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > 6 * 1024 * 1024) return NextResponse.json({ error: "chunk_too_large" }, { status: 413 });
  if (chunkIndex === 0) await writeFile(destination, bytes, { flag: "wx" });
  else await appendFile(destination, bytes);
  return NextResponse.json({
    complete: chunkIndex === chunkCount - 1,
    directory: path.relative(process.cwd(), directory).replaceAll("\\", "/"),
    filename,
  }, { headers: { "Cache-Control": "no-store" } });
}
