import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

type SupabaseBrowserClient = SupabaseClient<any, "public", any> | null;

let browserClient: SupabaseBrowserClient | undefined;

export function createSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;

  const config = getSupabaseConfig();

  if (!config) {
    browserClient = null;
    return null;
  }

  browserClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
  return browserClient;
}
