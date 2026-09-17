import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

// A missing .env should fail loudly on screen, not as a cryptic fetch error.
export const supabase = supabaseConfigured
  ? createClient(url, anonKey)
  : null;
