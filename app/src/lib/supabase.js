import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

// All ClayOS data lives in the `clayos` schema (exposed to PostgREST).
export const supabase = createClient(url, anon, { db: { schema: "clayos" } });

export const FUNCTIONS_URL = `${url}/functions/v1`;
export const ANON_KEY = anon;
