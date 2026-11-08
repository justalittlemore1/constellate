import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/** null in mock mode or when the public Supabase settings are missing. */
export const supabase: SupabaseClient | null =
  env.useMocks || !env.supabaseUrl || !env.supabaseAnonKey ? null : createClient(env.supabaseUrl, env.supabaseAnonKey);
