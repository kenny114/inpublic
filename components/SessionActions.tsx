"use client";

import { Copy, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, Tooltip } from "@/components/ProductUI";
import { downloadBlob } from "@/lib/recordings";
import { loadSessionById } from "@/lib/persist";
import type { SessionSummary } from "@/lib/sessions";

export async function exportSession(session: SessionSummary) {
  const stored = await loadSessionById(session.id);
  if (!stored) return;
  const name = session.title.replace(/[^\w-]+/g, "-").toLowerCase() || "session";
  downloadBlob(new Blob([JSON.stringify(stored, null, 2)], { type: "application/json" }), `inpublic-${name}.json`);
}

export type SessionAction = "open" | "rename" | "duplicate" | "export" | "delete";

const entries = [
  { action: "rename" as const, label: "Rename", Icon: Pencil },
  { action: "duplicate" as const, label: "Duplicate", Icon: Copy },
  { action: "export" as const, label: "Download", Icon: Download },
  { action: "delete" as const, label: "Delete", Icon: Trash2 },
];

export function SessionActionsMenu({ onAction, label }: { onAction: (action: SessionAction) => void; label: string }) {
  return (
    <DropdownMenu label={`Actions for ${label}`} trigger={<Tooltip label="Session actions"><span className="session-menu-trigger"><MoreHorizontal size={18} /></span></Tooltip>}>
      {entries.map(({ action, label: entryLabel, Icon }) => (
        <button key={action} type="button" role="menuitem" className={action === "delete" ? "destructive" : ""} onClick={() => onAction(action)}>
          <Icon size={15} />{entryLabel}
        </button>
      ))}
    </DropdownMenu>
  );
}
