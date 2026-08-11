"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { InPublicMode } from "@/lib/story";
import { features } from "@/lib/features";

const Board = dynamic(() => import("@/components/Board"), {
  ssr: false,
  loading: () => <div className="h-screen w-screen bg-white" />,
});

/**
 * `/create` alone keeps the previous behaviour exactly: the last autosave is
 * restored and decides the mode. The dashboard adds three optional requests:
 *
 *   ?mode=standard|story   open in this mode, outranking the saved one
 *   ?session=<id>          reopen this saved session instead of the last one
 *   ?new=1                 start blank, restoring nothing
 *
 * Story Mode is parked (lib/features.ts). A `?mode=story` with no `?session`
 * would be a stale link or bookmark starting something NEW in story — that
 * gets clamped to standard. Reopening a SPECIFIC existing session
 * (`?session=<id>&mode=story`, the shape every "open canvas" link for an old
 * story session already uses) still honors it, so existing story content
 * stays viewable — only starting something new in it is blocked here.
 */
function CreateBoard() {
  const params = useSearchParams();
  const requested = params.get("mode");
  const hasSession = Boolean(params.get("session"));
  const initialMode: InPublicMode | undefined =
    requested === "standard" || requested === "story"
      ? (requested === "story" && !features.storyMode && !hasSession ? "standard" : requested)
      : undefined;
  return (
    <Board
      initialMode={initialMode}
      initialSessionId={params.get("session") ?? undefined}
      startFresh={params.get("new") === "1"}
    />
  );
}

export default function CreatePage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-white" />}>
      <CreateBoard />
    </Suspense>
  );
}
