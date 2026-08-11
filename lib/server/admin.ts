import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

interface AccountIdentity {
  id: string;
  email?: string | null;
}

/** Database-owned admin access, with the deployment allowlist as a bootstrap fallback. */
export async function isAdminAccount(user: AccountIdentity | null | undefined) {
  if (!user) return false;
  const allowlist = new Set(
    (process.env.ADMIN_EMAIL_ALLOWLIST ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  if (user.email && allowlist.has(user.email.toLowerCase())) return true;
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return !error && data?.is_admin === true;
}

