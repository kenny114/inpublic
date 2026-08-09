"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { InPublicMode } from "@/lib/story";

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
 */
function CreateBoard() {
  const params = useSearchParams();
  const requested = params.get("mode");
  const initialMode: InPublicMode | undefined =
    requested === "standard" || requested === "story" ? requested : undefined;
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
