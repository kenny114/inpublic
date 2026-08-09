"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import {
  CloseIcon,
  ExportsIcon,
  HelpIcon,
  HomeIcon,
  MenuIcon,
  PlusIcon,
  RecordingsIcon,
  SearchIcon,
  SessionsIcon,
  SettingsIcon,
  VocabularyIcon,
} from "@/components/DashboardIcons";
import { useAuth } from "@/hooks/useAuth";
import { usePreferences } from "@/hooks/usePreferences";
import { signOut } from "@/lib/auth";
import { billing } from "@/lib/billing";
import { DISCORD_URL } from "@/lib/product";

type Item = { label: string; href: string; Icon: (props: { className?: string }) => React.JSX.Element };

const primary: Item[] = [
  { label: "Home", href: "/dashboard", Icon: HomeIcon },
  { label: "Sessions", href: "/dashboard/sessions", Icon: SessionsIcon },
  { label: "Recordings", href: "/dashboard/recordings", Icon: RecordingsIcon },
  { label: "Visual vocabulary", href: "/dashboard/vocabulary", Icon: VocabularyIcon },
  { label: "Exports", href: "/dashboard/exports", Icon: ExportsIcon },
];

const secondary: Item[] = [
  { label: "Settings", href: "/dashboard/settings", Icon: SettingsIcon },
  { label: "Help & Discord", href: "/dashboard/community", Icon: HelpIcon },
];

function NavLink({ item, active, onNavigate }: { item: Item; active: boolean; onNavigate: () => void }) {
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
        active
          ? "bg-indigo-50/80 font-medium text-indigo-950"
          : "text-zinc-600 hover:bg-zinc-100/70 hover:text-zinc-900"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-indigo-500" : "text-zinc-400"}`} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function AccountMenu() {
  const { ready, user } = useAuth();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  // `ready` is false on the server and on the first client render, so both
  // produce the signed-out markup and hydration matches.
  if (!ready || !user) {
    return <Link href="/login" className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Log in</Link>;
  }

  const initial = user.email.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-900 hover:bg-indigo-200"
      >
        <span className="sr-only">Account menu</span>
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-50 w-60 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg shadow-zinc-900/5">
          <div className="border-b border-zinc-100 px-2.5 pb-2.5 pt-2">
            <p className="truncate text-sm font-medium">{user.email}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{billing.configured ? "Paid plan" : "Free plan"}</p>
          </div>
          <Link href="/dashboard/settings" role="menuitem" onClick={() => setOpen(false)} className="mt-1 block rounded-lg px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">Settings</Link>
          <a href={DISCORD_URL} target="_blank" rel="noreferrer" role="menuitem" className="block rounded-lg px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">Discord</a>
          <Link href="/" role="menuitem" onClick={() => setOpen(false)} className="block rounded-lg px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">Back to inpublic.com</Link>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); signOut(); }} className="mt-1 block w-full rounded-lg border-t border-zinc-100 px-2.5 py-1.5 pt-2 text-left text-sm text-zinc-700 hover:bg-zinc-50">Log out</button>
        </div>
      )}
    </div>
  );
}

function PlanCard() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
      <p className="text-xs font-medium text-zinc-900">{billing.configured ? "Paid plan" : "Free plan"}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        {billing.configured
          ? "Manage your plan in settings."
          : "Sessions are stored in this browser. Billing is not connected yet."}
      </p>
      <Link href="/dashboard/settings" className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-700">
        {billing.configured ? "Manage plan" : "View plan details"}
      </Link>
    </div>
  );
}

function SessionSearch({ onSubmitted }: { onSubmitted?: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  // Keep the field in step with the URL so a shared /dashboard/sessions?q=…
  // link shows its own query rather than an empty box.
  useEffect(() => {
    setQuery(pathname === "/dashboard/sessions" ? params.get("q") ?? "" : "");
  }, [params, pathname]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    router.push(trimmed ? `/dashboard/sessions?q=${encodeURIComponent(trimmed)}` : "/dashboard/sessions");
    onSubmitted?.();
  };

  return (
    <form onSubmit={submit} role="search" className="relative w-full max-w-sm">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search sessions"
        aria-label="Search sessions"
        className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400"
      />
    </form>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Straight to the canvas — no chooser step. The stored default decides the
  // mode, and the canvas control bar can switch it. Preferences start at the
  // declared default on the server and on the first client render, so the href
  // React hydrates is the one it rendered.
  const { preferences } = usePreferences();
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  const close = () => setMenuOpen(false);

  // A route change should never leave the mobile drawer covering the page.
  useEffect(close, [pathname]);

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-3">
      <div className="px-2.5 pt-2">
        <Link href="/" onClick={close} className="text-[15px] font-semibold tracking-tight">InPublic</Link>
        <p className="mt-0.5 text-xs text-zinc-500">Personal workspace</p>
      </div>
      <nav aria-label="Workspace" className="flex flex-col gap-0.5">
        {primary.map((item) => <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={close} />)}
      </nav>
      <div className="mt-auto flex flex-col gap-3">
        <PlanCard />
        <nav aria-label="Account" className="flex flex-col gap-0.5">
          {secondary.map((item) => <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={close} />)}
        </nav>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#fcfcfb] text-zinc-950">
      {/* Desktop and tablet: a fixed rail. Mobile: the same markup in a drawer. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] border-r border-zinc-200 bg-white md:block">
        {sidebar}
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close navigation" onClick={close} className="absolute inset-0 bg-zinc-900/20" />
          <div className="absolute inset-y-0 left-0 w-[264px] border-r border-zinc-200 bg-white">{sidebar}</div>
        </div>
      )}

      <div className="md:pl-[236px]">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-[#fcfcfb]/90 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-600 md:hidden"
            >
              {menuOpen ? <CloseIcon className="h-4 w-4" /> : <MenuIcon className="h-4 w-4" />}
            </button>
            <div className="hidden flex-1 sm:block">
              {/* useSearchParams needs a boundary so the shell can still be
                  statically prerendered around it. */}
              <Suspense fallback={<div className="h-9 w-full max-w-sm rounded-lg border border-zinc-200 bg-white" />}>
                <SessionSearch />
              </Suspense>
            </div>
            <div className="flex flex-1 items-center justify-end gap-3 sm:flex-none">
              <Link
                href={`/create?mode=${preferences.defaultMode}&new=1`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                <PlusIcon className="h-4 w-4" />
                New session
              </Link>
              <AccountMenu />
            </div>
          </div>
          <div className="border-t border-zinc-100 px-4 py-2 sm:hidden">
            <Suspense fallback={<div className="h-9 w-full rounded-lg border border-zinc-200 bg-white" />}>
              <SessionSearch onSubmitted={close} />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
