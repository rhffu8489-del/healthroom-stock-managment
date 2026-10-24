import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { requestOrigin } from '@/lib/request-origin';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (tokenHash && type && ['signup', 'email', 'recovery'].includes(type) && getSupabaseConfig()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    if (!error) return NextResponse.redirect(new URL(type === 'recovery' ? '/reset-password' : '/', origin));
  }
  return NextResponse.redirect(new URL('/login?error=invalid-link', origin));
}
