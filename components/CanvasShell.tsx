"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown, Download, FileJson, FileText, Image as ImageIcon, LogOut, Settings, User } from "lucide-react";
import { Button, DropdownMenu, SavedStatus, type SaveState, Tooltip } from "@/components/ProductUI";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/lib/auth";
import { useRouter } from "next/navigation";

type ExportKind = "png" | "svg" | "excalidraw" | "json";
const showDeveloperExports = process.env.NODE_ENV === "development";

export function CanvasTopBar({ title, saveState, remainingSeconds, onTitleChange, onExport, onDownloadLog }: { title: string; saveState: SaveState; remainingSeconds: number | null; onTitleChange: (title: string) => void; onExport: (kind: ExportKind) => void; onDownloadLog: () => void }) {
  const router = useRouter();
  const { ready, user } = useAuth();
  const initial = ready && user ? (user.email ?? "").trim().charAt(0).toUpperCase() || "?" : "?";
  return (
    <header className="canvas-topbar" onPointerDown={(event) => event.stopPropagation()}>
      <div className="canvas-topbar-left">
        <Tooltip label="Back to dashboard"><Link href="/dashboard" className="canvas-back" aria-label="Back to dashboard"><ArrowLeft size={18} /></Link></Tooltip>
        <span className="canvas-topbar-divider" />
        <input value={title} onChange={(event) => onTitleChange(event.target.value)} onBlur={(event) => { if (!event.target.value.trim()) onTitleChange("Untitled visual session"); }} maxLength={120} aria-label="Session title" className="canvas-title-input" />
      </div>
      <div className="canvas-topbar-actions">
        {remainingSeconds !== null ? <span className="ui-saved-status" aria-label="Visual speech time remaining">{Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")} left</span> : null}
        <SavedStatus state={saveState} />
        <DropdownMenu label="Export session" trigger={<span className="canvas-export-trigger"><Download size={15} />Export<ChevronDown size={13} /></span>}>
          <button type="button" role="menuitem" onClick={() => onExport("png")}><ImageIcon size={15} />PNG image</button>
          <button type="button" role="menuitem" onClick={() => onExport("svg")}><ImageIcon size={15} />SVG image</button>
          <button type="button" role="menuitem" onClick={() => onExport("excalidraw")}><FileText size={15} />Excalidraw file</button>
          {showDeveloperExports ? <>
            <button type="button" role="menuitem" onClick={() => onExport("json")}><FileJson size={15} />Session JSON</button>
            <button type="button" role="menuitem" onClick={onDownloadLog}><FileText size={15} />Session log</button>
          </> : null}
        </DropdownMenu>
        {ready && user ? (
          <DropdownMenu label="Account menu" trigger={<span className="canvas-account-trigger">{initial}</span>}>
            <div className="dashboard-account-copy"><strong>{user.email}</strong><span>InPublic account</span></div>
            <Link href="/dashboard/settings" role="menuitem"><Settings size={15} />Settings</Link>
            <button type="button" role="menuitem" onClick={() => void signOut().then(() => { router.replace("/login"); router.refresh(); })}><LogOut size={15} />Sign out</button>
          </DropdownMenu>
        ) : <Button tone="ghost" className="canvas-account-trigger" aria-label="Account"><User size={16} /></Button>}
      </div>
    </header>
  );
}
