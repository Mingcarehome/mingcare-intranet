import { getSupabase, supabase } from './supabase'

// Legacy imports share the signed-in browser client and its RLS permissions.
// getSupabase() and supabase remain null during build/SSR.
export const getSupabaseAdmin = getSupabase
export const supabaseAdmin = supabase
