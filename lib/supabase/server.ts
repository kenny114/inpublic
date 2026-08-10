import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { publicSupabaseConfig } from "./env";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const { url, key } = publicSupabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot write cookies. middleware.ts refreshes them.
        }
      },
    },
  });
}

export const getAuthenticatedUser = cache(async () => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
});
