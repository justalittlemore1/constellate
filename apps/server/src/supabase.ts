import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';

/** Service-role client. Server only: this key bypasses RLS, so every write sets user_id itself. */
export function createServiceClient(env: Env): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Verifies a Supabase access token. Returns the user id, or null if the token is invalid. */
export interface Auth {
  verifyToken(token: string): Promise<string | null>;
}

export function supabaseAuth(db: SupabaseClient): Auth {
  return {
    async verifyToken(token) {
      if (!token) return null;
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user) return null;
      return data.user.id;
    },
  };
}

/** Used when Supabase is not configured: every token is rejected. */
export const rejectAllAuth: Auth = { verifyToken: async () => null };

/** `Authorization: Bearer <token>` → token */
export function bearer(header: string | undefined): string | null {
  const m = header?.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}
