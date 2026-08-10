"use client";

import Link from "next/link";
import { ChevronDown, FileDown, FolderOpen, Menu, Mic2, Settings, Video } from "lucide-react";
import { usePathname } from "next/navigation";
import { ButtonLink, DropdownMenu, Logo, PageContainer } from "@/components/ProductUI";
import { useAuth } from "@/hooks/useAuth";
import { usePreferences } from "@/hooks/usePreferences";
import { signOut } from "@/lib/auth";
import { useRouter } from "next/navigation";

const nav = [
  { label: "Sessions", href: "/dashboard/sessions", Icon: FolderOpen },
  { label: "Recordings", href: "/dashboard/recordings", Icon: Video },
  { label: "Exports", href: "/dashboard/exports", Icon: FileDown },
];

function AccountMenu() {
  const router = useRouter();
  const { ready, user } = useAuth();
  if (!ready || !user) return <Link href="/login" className="dashboard-sign-in">Sign in</Link>;
  const initial = (user.email ?? "").trim().charAt(0).toUpperCase() || "?";
  return (
    <DropdownMenu label="Account menu" trigger={<span className="dashboard-avatar">{initial}<ChevronDown size={13} /></span>}>
      <div className="dashboard-account-copy"><strong>{user.email}</strong><span>InPublic account</span></div>
      <Link href="/dashboard/settings" role="menuitem"><Settings size={15} />Settings</Link>
      <Link href="/" role="menuitem">View landing page</Link>
      <button type="button" role="menuitem" onClick={() => void signOut().then(() => { router.replace("/login"); router.refresh(); })}>Sign out</button>
    </DropdownMenu>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { preferences } = usePreferences();
  const newSessionHref = `/create?mode=${preferences.defaultMode}&new=1`;
  return (
    <div className="dashboard-surface">
      <header className="dashboard-header">
        <PageContainer className="dashboard-header-inner">
          <Logo href="/dashboard" />
          <nav aria-label="Dashboard navigation" className="dashboard-nav">
            {nav.map(({ label, href, Icon }) => <Link key={href} href={href} aria-current={pathname.startsWith(href) ? "page" : undefined}><Icon size={15} />{label}</Link>)}
          </nav>
          <div className="dashboard-actions">
            <div className="dashboard-mobile-nav">
              <DropdownMenu label="Dashboard navigation" trigger={<span className="dashboard-icon-button"><Menu size={18} /></span>} align="left">
                <Link href="/dashboard" role="menuitem">Dashboard</Link>
                {nav.map(({ label, href, Icon }) => <Link key={href} href={href} role="menuitem"><Icon size={15} />{label}</Link>)}
              </DropdownMenu>
            </div>
            <ButtonLink href={newSessionHref}><Mic2 size={15} />New visual session</ButtonLink>
            <AccountMenu />
          </div>
        </PageContainer>
      </header>
      <main className="dashboard-main"><PageContainer>{children}</PageContainer></main>
    </div>
  );
}
