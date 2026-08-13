"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown, Download, FileJson, FileText, Image as ImageIcon, LogOut, Settings, User } from "lucide-react";
import { Button, DropdownMenu, SavedStatus, type SaveState, Tooltip } from "@/components/ProductUI";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/lib/auth";
import { useRouter } from "next/navigation";

type ExportKind = "png" | "svg" | "excalidraw" | "json";
/**
 * The scene JSON dump and the raw session log (interim/camera/composition
 * event trace) are both development affordances, not something a normal
 * user has a use for.
 *
 * The session log used to be exempted from this gate so production sessions
 * — the only ones running on real hardware, real networks, and real speech —
 * could report their own latency numbers. That reasoning no longer applies:
 * lib/latencySink.ts now posts latency summaries to /api/telemetry/latency
 * automatically when a session stops, in every environment, with no button
 * required. The manual download is dev-only again.
 */
const showDeveloperExports = process.env.NODE_ENV === "development";

export function CanvasTopBar({ title, saveState, remainingSeconds, unlimitedMinutes = false, onTitleChange, onExport, onDownloadLog, guest = false }: { title: string; saveState: SaveState; remainingSeconds: number | null; unlimitedMinutes?: boolean; onTitleChange: (title: string) => void; onExport: (kind: ExportKind) => void; onDownloadLog: () => void; guest?: boolean }) {
  const router = useRouter();
  const { ready, user } = useAuth();
  const initial = ready && user ? (user.email ?? "").trim().charAt(0).toUpperCase() || "?" : "?";
  // /dashboard is an authenticated route — a guest has nothing to go back to
  // there, so "back" leaves the trial rather than bouncing through a login
  // redirect.
  const backHref = guest ? "/try" : "/dashboard";
  return (
    <header className="canvas-topbar" onPointerDown={(event) => event.stopPropagation()}>
      <div className="canvas-topbar-left">
        <Tooltip label={guest ? "Back to trial" : "Back to dashboard"}><Link href={backHref} className="canvas-back" aria-label={guest ? "Back to trial" : "Back to dashboard"}><ArrowLeft size={18} /></Link></Tooltip>
        <span className="canvas-topbar-divider" />
        <input value={title} onChange={(event) => onTitleChange(event.target.value)} onBlur={(event) => { if (!event.target.value.trim()) onTitleChange("Untitled visual session"); }} maxLength={120} aria-label="Session title" className="canvas-title-input" />
      </div>
      <div className="canvas-topbar-actions">
        {unlimitedMinutes ? <span className="ui-saved-status" aria-label="Unlimited visual speech time">Unlimited</span> : remainingSeconds !== null ? <span className="ui-saved-status" aria-label="Visual speech time remaining">{Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")} left</span> : null}
        {!guest ? <SavedStatus state={saveState} /> : null}
        <DropdownMenu label="Export session" trigger={<span className="canvas-export-trigger"><Download size={15} />Export<ChevronDown size={13} /></span>}>
          <button type="button" role="menuitem" onClick={() => onExport("png")}><ImageIcon size={15} />PNG image</button>
          <button type="button" role="menuitem" onClick={() => onExport("svg")}><ImageIcon size={15} />SVG image</button>
          <button type="button" role="menuitem" onClick={() => onExport("excalidraw")}><FileText size={15} />Excalidraw file</button>
          {showDeveloperExports ? <button type="button" role="menuitem" onClick={() => onExport("json")}><FileJson size={15} />Session JSON</button> : null}
          {showDeveloperExports ? <button type="button" role="menuitem" onClick={onDownloadLog}><FileText size={15} />Session log</button> : null}
        </DropdownMenu>
        {ready && user ? (
          <DropdownMenu label="Account menu" trigger={<span className="canvas-account-trigger">{initial}</span>}>
            <div className="dashboard-account-copy"><strong>{user.email}</strong><span>InPublic account</span></div>
            <Link href="/dashboard/settings" role="menuitem"><Settings size={15} />Settings</Link>
            <button type="button" role="menuitem" onClick={() => void signOut().then(() => { router.replace("/login"); router.refresh(); })}><LogOut size={15} />Sign out</button>
          </DropdownMenu>
        ) : guest ? (
          <Tooltip label="Create a free account to save this"><Link href="/login?next=/try&claim=1" className="canvas-account-trigger" aria-label="Create a free account"><User size={16} /></Link></Tooltip>
        ) : <Button tone="ghost" className="canvas-account-trigger" aria-label="Account"><User size={16} /></Button>}
      </div>
    </header>
  );
}
