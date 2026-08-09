import Link from "next/link";
import { MODE_LABEL, STATUS_LABEL, type SessionStatus } from "@/lib/sessions";
import type { InPublicMode } from "@/lib/story";

/** Shared chrome for the dashboard pages: one page header, one empty state. */
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-dashed border-zinc-300 bg-white px-6 py-14 text-center">
      <p className="text-sm font-medium text-zinc-900">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">{body}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function ModeBadge({ mode }: { mode: InPublicMode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
      mode === "story" ? "bg-amber-50 text-amber-800" : "bg-[#eff0ff] text-[#4b4db2]"
    }`}>
      {MODE_LABEL[mode]}
    </span>
  );
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const tone =
    status === "recorded" ? "bg-emerald-50 text-emerald-800"
    : status === "in-progress" ? "bg-zinc-100 text-zinc-700"
    : "bg-zinc-50 text-zinc-500";
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>{STATUS_LABEL[status]}</span>;
}

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-zinc-950 px-3.5 text-sm font-medium text-white hover:bg-zinc-800">{children}</Link>;
}

export function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-zinc-200 bg-white px-3.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50">{children}</Link>;
}

/** A statement of fact about something the product cannot do yet. */
export function NotReadyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 rounded-[10px] border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-600">
      {children}
    </p>
  );
}
