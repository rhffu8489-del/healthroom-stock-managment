import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { isSameOrigin } from '@/lib/request-origin';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response('허용되지 않은 요청입니다.', { status: 403 });
  if (getSupabaseConfig()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) return NextResponse.json({ error: '로그아웃하지 못했습니다. 다시 시도해 주세요.' }, { status: 503 });
  }
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
