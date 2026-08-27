"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const Board = dynamic(() => import("@/components/Board"), {
  ssr: false,
  loading: () => <div className="h-screen w-screen bg-white" />,
});

/**
 * `/create` alone keeps the previous behaviour exactly: the last autosave is
 * restored. The dashboard adds two optional requests:
 *
 *   ?session=<id>   reopen this saved session instead of the last one
 *   ?new=1          start blank, restoring nothing
 *
 * Story Mode was removed in Strip-Down Phase 2 — there is only one mode now,
 * so `?mode=` is no longer read.
 */
function CreateBoard() {
  const params = useSearchParams();
  return (
    <Board
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
