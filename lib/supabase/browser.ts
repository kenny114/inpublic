"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "./env";

let client: SupabaseClient | null = null;

export function createBrowserSupabaseClient(): SupabaseClient {
  const { url, key } = publicSupabaseConfig();
  client ??= createBrowserClient(url, key);
  return client;
}
