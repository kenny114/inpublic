"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, type MouseEvent } from "react";
import { ButtonLink, Logo } from "@/components/ProductUI";

const sections = [["Product", "product"], ["Examples", "examples"], ["Pricing", "pricing"], ["FAQ", "faq"]] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const jump = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    setOpen(false);
    if (pathname !== "/") return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <header className="landing-header">
      <div className="landing-header-inner">
        <Logo />
        <button type="button" className="landing-menu-button" aria-expanded={open} aria-controls="landing-nav" onClick={() => setOpen((value) => !value)}>
          <span className="sr-only">Toggle navigation</span>{open ? <X size={18} /> : <Menu size={18} />}
        </button>
        <nav id="landing-nav" className={open ? "open" : ""} aria-label="Primary navigation">
          {sections.map(([label, id]) => <a key={id} href={`/#${id}`} onClick={jump(id)}>{label}</a>)}
          <Link href="/login" onClick={() => setOpen(false)}>Sign in</Link>
          <ButtonLink href="/create?new=1" className="landing-nav-cta">Start speaking</ButtonLink>
        </nav>
      </div>
    </header>
  );
}
