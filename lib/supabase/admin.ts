import "server-only";

import { createClient } from "@supabase/supabase-js";
import { serviceRoleConfig } from "./server-env";

/** Per-request only: never retain an admin client across Fluid Compute requests. */
export function createAdminClient() {
  const { url, key } = serviceRoleConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
