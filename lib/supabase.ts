import { createClient as createSupabaseClient } from '@supabase/supabase-js'

let _supabase: any = null

export const createClient = () => {
  // Only create client in browser environment
  if (typeof window === 'undefined') {
    return null
  }

  // Migrate legacy plaintext passwords even when a saved session opens a dashboard.
  try {
    window.localStorage.removeItem('mingcare_password')
  } catch {
    // Browser storage can be disabled; allow Supabase's existing storage fallback.
  }
  
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Lazy getter function
export function getSupabase() {
  if (typeof window === 'undefined') {
    return null
  }
  
  if (!_supabase) {
    _supabase = createClient()
  }
  
  return _supabase
}

// For backward compatibility - use getter on first access
export const supabase = typeof window === 'undefined' ? null : (getSupabase() as any)
