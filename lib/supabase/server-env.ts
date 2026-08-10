import "server-only";
import { publicSupabaseConfig } from "./env";

export function serviceRoleConfig() {
  const { url } = publicSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return { url, key };
}
