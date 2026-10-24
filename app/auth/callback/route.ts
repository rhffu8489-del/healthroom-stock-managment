import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (code && getSupabaseConfig()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(url.searchParams.get('next') === '/reset-password' ? '/reset-password' : '/', url.origin));
  }
  return NextResponse.redirect(new URL('/login?error=invalid-link', url.origin));
}
