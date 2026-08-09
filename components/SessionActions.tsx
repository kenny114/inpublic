"use client";

import { useEffect, useRef, useState } from "react";
import { MoreIcon } from "@/components/DashboardIcons";
import { downloadBlob } from "@/lib/recordings";
import { loadSessionById } from "@/lib/persist";
import type { SessionSummary } from "@/lib/sessions";

/**
 * Exporting a session means handing back everything the browser holds about it:
 * the elements, the semantic board, the story state and the log. Recordings are
 * separate files and are downloaded from the Recordings page.
 */
export async function exportSession(session: SessionSummary) {
  const stored = await loadSessionById(session.id);
  if (!stored) return;
  const name = session.title.replace(/[^\w-]+/g, "-").toLowerCase() || "session";
  downloadBlob(
    new Blob([JSON.stringify(stored, null, 2)], { type: "application/json" }),
    `inpublic-${name}.json`,
  );
}

export type SessionAction = "open" | "rename" | "duplicate" | "export" | "delete";

const entries: Array<[SessionAction, string]> = [
  ["open", "Open"],
  ["rename", "Rename"],
  ["duplicate", "Duplicate"],
  ["export", "Export"],
  ["delete", "Delete"],
];

export function SessionActionsMenu({ onAction, label }: { onAction: (action: SessionAction) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }}
        className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
      >
        <span className="sr-only">Actions for {label}</span>
        <MoreIcon className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-30 w-40 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-900/5">
          {entries.map(([action, text]) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false); onAction(action); }}
              className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-zinc-50 ${action === "delete" ? "text-red-600" : "text-zinc-700"}`}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
