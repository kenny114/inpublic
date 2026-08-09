"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type MouseEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { DISCORD_URL } from "@/lib/product";

/** Every entry points at a section that exists in app/page.tsx. */
const sections: Array<[label: string, id: string]> = [
  ["Product", "product"],
  ["Standard Mode", "standard"],
  ["Story Mode", "story"],
  ["Pricing", "pricing"],
  ["Future self-hosting", "foundation"],
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { ready, user } = useAuth();
  const onLanding = pathname === "/";

  // Off the landing page these stay ordinary `/#id` links and the browser does
  // the work. On the landing page a full navigation would be wasteful, so we
  // scroll in place and keep the hash in the address bar.
  const jump = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    setOpen(false);
    if (!onLanding) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="text-base font-semibold tracking-tight" onClick={() => setOpen(false)}>InPublic</Link>
        <button type="button" className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm md:hidden" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Menu</button>
        <nav className={`${open ? "flex" : "hidden"} absolute inset-x-0 top-16 flex-col gap-4 border-b border-zinc-200 bg-white p-5 text-sm text-zinc-600 md:static md:flex md:flex-row md:items-center md:gap-5 md:border-0 md:p-0`}>
          {sections.map(([label, id]) => (
            <a key={id} href={`/#${id}`} onClick={jump(id)} className="hover:text-zinc-950">{label}</a>
          ))}
          <a href={DISCORD_URL} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="hover:text-zinc-950">Discord</a>
          {/* `ready` is false during SSR and the first client render, so both
              sides emit the same neutral label until localStorage is read. */}
          {ready && user ? (
            <Link href="/dashboard" onClick={() => setOpen(false)} className="hover:text-zinc-950">Dashboard</Link>
          ) : (
            <Link href="/login" onClick={() => setOpen(false)} className="hover:text-zinc-950">Log in</Link>
          )}
          <Link href="/dashboard" onClick={() => setOpen(false)} className="rounded-lg bg-zinc-950 px-3.5 py-2 font-medium text-white hover:bg-zinc-800">Start creating</Link>
        </nav>
      </div>
    </header>
  );
}
