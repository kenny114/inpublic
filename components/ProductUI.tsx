"use client";

import Link from "next/link";
import Image from "next/image";
import { Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const buttonStyles = {
  primary: "ui-button ui-button-primary",
  secondary: "ui-button ui-button-secondary",
  destructive: "ui-button ui-button-destructive",
  ghost: "ui-button ui-button-ghost",
} as const;

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="ui-logo" aria-label="InPublic home">
      <span className="ui-logo-mark" aria-hidden="true"><Image src="/inpublic-logo.png" alt="" width={30} height={30} /></span>
      <span>InPublic</span>
    </Link>
  );
}

export function Button({ tone = "primary", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof buttonStyles }) {
  return <button {...props} className={`${buttonStyles[tone]} ${className}`} />;
}

export function ButtonLink({ href, tone = "primary", className = "", children }: { href: string; tone?: keyof typeof buttonStyles; className?: string; children: ReactNode }) {
  return <Link href={href} className={`${buttonStyles[tone]} ${className}`}>{children}</Link>;
}

export function PageContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ui-page-container ${className}`}>{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`ui-skeleton ${className}`} aria-hidden="true" />;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="ui-empty-state">
      <span className="ui-empty-canvas" aria-hidden="true"><i /><i /><i /></span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </div>
  );
}

export function Modal({ open, title, description, children, footer, onClose }: { open: boolean; title: string; description?: string; children?: ReactNode; footer?: ReactNode; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="ui-modal-layer" role="presentation">
      <button className="ui-modal-backdrop" type="button" aria-label="Close dialog" onClick={onClose} />
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button type="button" className="ui-modal-close" onClick={onClose} aria-label="Close dialog"><X size={17} /></button>
        <h2 id="modal-title">{title}</h2>
        {description ? <p className="ui-modal-description">{description}</p> : null}
        {children ? <div className="ui-modal-body">{children}</div> : null}
        {footer ? <div className="ui-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function DropdownMenu({ label, trigger, children, align = "right" }: { label: string; trigger: ReactNode; children: ReactNode; align?: "left" | "right" }) {
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
    <div className="ui-dropdown" ref={container}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }} className="ui-dropdown-trigger">
        {trigger}
      </button>
      {open ? <div role="menu" className={`ui-dropdown-menu ${align === "left" ? "align-left" : ""}`} onClick={() => setOpen(false)}>{children}</div> : null}
    </div>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="ui-tooltip" data-tooltip={label}>{children}</span>;
}

export type SaveState = "saving" | "saved" | "offline" | "failed";

export function SavedStatus({ state }: { state: SaveState }) {
  return (
    <span className={`ui-saved-status ${state}`} role="status">
      {state === "saving" ? <LoaderCircle size={13} className="ui-spin" /> : state === "saved" ? <Check size={13} /> : <span aria-hidden="true">!</span>}
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "offline" ? "Saved locally" : "Cloud save failed"}
    </span>
  );
}

export function RecordingStatus({ active, busy, connecting, error }: { active: boolean; busy: boolean; connecting: boolean; error: boolean }) {
  const text = error ? "Microphone needs attention" : connecting ? "Connecting to microphone…" : busy ? "Understanding and adding to your canvas…" : active ? "Listening…" : "Ready when you are";
  return <span className={`ui-recording-status ${error ? "error" : active ? "active" : ""}`} role="status"><i />{text}</span>;
}

export function Toast({ message, actionLabel, onAction, onDismiss, duration = 6000 }: { message: string; actionLabel?: string; onAction?: () => void; onDismiss: () => void; duration?: number }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div className="ui-toast" role="status">
      <Check size={16} />
      <span>{message}</span>
      {actionLabel && onAction ? <button type="button" onClick={onAction}>{actionLabel}</button> : null}
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification"><X size={15} /></button>
    </div>
  );
}
