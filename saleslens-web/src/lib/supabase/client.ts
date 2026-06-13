import { createClient } from "@supabase/supabase-js";
import { assertSupabaseConfig } from "./config";

const { supabaseUrl, supabaseAnonKey } = assertSupabaseConfig();

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
