import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client initialization.
 * Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS securely on backend routes.
 */
let supabaseClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && key && url.trim().length > 5 && key.trim().length > 10);
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!supabaseClient) {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)!;
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;

    supabaseClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return supabaseClient;
}
