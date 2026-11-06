import { createClient } from "@supabase/supabase-js";
import { createMockClient } from "../dev/mockBackend.js";

// VITE_MOCK_BACKEND=1 swaps in the local in-memory test backend (gate runs,
// screenshots, laptop demos). Vite replaces the env check at build time, so
// a normal build drops the mock entirely.
const MOCK = import.meta.env.VITE_MOCK_BACKEND === "1";
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isMockBackend = MOCK;
export const supabaseConfigured = MOCK || Boolean(url && anonKey);

// A missing .env should fail loudly on screen, not as a cryptic fetch error.
export const supabase = MOCK ? createMockClient() : supabaseConfigured ? createClient(url, anonKey) : null;
