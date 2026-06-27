// Shared Supabase admin client (service role, clayos schema) for edge functions.
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { db: { schema: "clayos" }, auth: { persistSession: false } });
}
