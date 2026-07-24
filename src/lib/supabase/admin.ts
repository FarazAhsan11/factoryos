import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for privileged server-side work (Admin API,
 * Storage writes, cross-tenant reads). Bypasses RLS — NEVER import this into a
 * Client Component, and always authorize the caller first.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
