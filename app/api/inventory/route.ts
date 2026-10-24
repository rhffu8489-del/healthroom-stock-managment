import { getCurrentUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function readRows(db: Awaited<ReturnType<typeof createClient>>, table: 'items' | 'movements', owner: string) {
  const rows: Record<string, unknown>[] = [];
  const maximum = table === 'movements' ? 10000 : Infinity;
  for (let offset = 0; offset < maximum; offset += 1000) {
    let query = db.from(table).select('*').eq('owner', owner).order('created', { ascending: false }).order('id');
    if (table === 'items') query = query.eq('archived', 0);
    const { data, error } = await query.range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

export async function GET() {
  if (!getSupabaseConfig()) return json({ error: '데이터 저장소 연결을 준비하고 있습니다.' }, 503);
  const user = await getCurrentUser();
  if (!user) return json({ error: '로그인이 필요합니다.' }, 401);
  const db = await createClient();
  try {
    const [items, movements, settings] = await Promise.all([
      readRows(db, 'items', user.id),
      readRows(db, 'movements', user.id),
      db.from('settings').select('warning_days,room_name').eq('owner', user.id).maybeSingle(),
    ]);
    if (settings.error) throw settings.error;
    return json({ items, movements, settings: settings.data || { warning_days: 30, room_name: '우리 학교 보건실' } });
  } catch {
    return json({ error: '저장된 기록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, 503);
  }
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: '허용되지 않은 요청입니다.' }, 403);
  if (!getSupabaseConfig()) return json({ error: '데이터 저장소 연결을 준비하고 있습니다.' }, 503);
  const user = await getCurrentUser();
  if (!user) return json({ error: '로그인이 필요합니다.' }, 401);
  try {
    const text = await request.text();
    if (text.length > 1000000) return json({ error: '한 번에 전송할 수 있는 데이터 크기를 초과했습니다.' }, 413);
    const payload: unknown = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: '요청 내용을 확인해 주세요.' }, 400);
    const db = await createClient();
    const { data, error } = await db.rpc('inventory_mutate', { p_payload: payload });
    if (error) return json({ error: error.code === 'P0001' || error.code === 'P0002' ? error.message : '입력한 수량·날짜와 저장소 연결을 확인해 주세요.' }, error.code === 'P0002' ? 404 : 400);
    return json(data);
  } catch {
    return json({ error: '요청 내용을 확인해 주세요.' }, 400);
  }
}
