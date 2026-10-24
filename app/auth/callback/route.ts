import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { requestOrigin } from '@/lib/request-origin';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const code = url.searchParams.get('code');
  if (code && getSupabaseConfig()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(url.searchParams.get('next') === '/reset-password' ? '/reset-password' : '/', origin));
  }
  return NextResponse.redirect(new URL('/login?error=invalid-link', origin));
}
