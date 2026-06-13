import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

export function createSupabaseBrowserClient() {
  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey);
}
