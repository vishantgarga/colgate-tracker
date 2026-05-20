import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://hsuznaasirivjvikwboe.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzdXpuYWFzaXJpdmp2aWt3Ym9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyODgyNDMsImV4cCI6MjA5NDg2NDI0M30.tVQh461TffMqy_DumNNNwIX_FrCEVxCKG2-bosnpPZE'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const ROW_ID = 'vishant-colgate-v1'

export async function loadFromSupabase(fallback) {
  try {
    const { data, error } = await supabase
      .from('field_data')
      .select('days')
      .eq('id', ROW_ID)
      .single()
    if (error || !data) return fallback
    return data.days
  } catch (_) {
    return fallback
  }
}

export async function saveToSupabase(days) {
  try {
    const { error } = await supabase
      .from('field_data')
      .upsert({ id: ROW_ID, user_id: 'vishant', days, updated_at: new Date().toISOString() })
    return !error
  } catch (_) {
    return false
  }
}
