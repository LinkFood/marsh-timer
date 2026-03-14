import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export const SUPABASE_FUNCTIONS_URL = supabaseUrl
  ? `${supabaseUrl}/functions/v1`
  : '';
// QA build trigger Sat Mar 14 08:02:35 EDT 2026
