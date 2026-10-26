import { getCurrentUser } from '@/lib/auth';
import { getProductGtin } from '@/lib/barcode';
import { lookupMedicalProduct } from '@/lib/product-lookup';

export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request) {
  if (!await getCurrentUser()) return json({ error: '로그인이 필요합니다.' }, 401);
  const code = new URL(request.url).searchParams.get('code') || '';
  try {
    const gtin = getProductGtin(code);
    if (!gtin) return json({ status: 'unsupported' });
    return json(await lookupMedicalProduct(gtin));
  } catch { return json({ error: '제품번호를 확인해 주세요.' }, 400); }
}
