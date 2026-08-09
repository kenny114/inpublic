import { Suspense } from "react";
import { PageHeader, PrimaryLink } from "@/components/DashboardUI";
import { SessionsBrowser } from "@/components/SessionsBrowser";

export default function SessionsPage() {
  return (
    <div>
      <PageHeader
        title="Sessions"
        description="Every session saved in this browser. Open one to continue where you stopped."
        action={<PrimaryLink href="/create?mode=standard&amp;new=1">New session</PrimaryLink>}
      />
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-zinc-400">Loading sessions…</p>}>
          <SessionsBrowser />
        </Suspense>
      </div>
    </div>
  );
}
