import 'server-only';
import { cache } from 'react';
import { createClient } from './supabase/server';
import { getSupabaseConfig } from './supabase/config';

export const getCurrentUser = cache(async () => {
  if (!getSupabaseConfig()) return null;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error ? null : user;
});

export function userDisplayName(user: { email?: string; user_metadata: Record<string, unknown> }) {
  const name = user.user_metadata.display_name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : user.email || '보건 선생님';
}
