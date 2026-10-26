export type ProductInfo = {
  name: string;
  manufacturer: string;
  model: string;
  description: string;
  sourceUrl: string;
};
export type ProductLookup =
  | { status: 'found'; product: ProductInfo }
  | { status: 'not_found' | 'unavailable' | 'unsupported' };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/** Exact DI/package matches only. Database flags such as expirationDate=true
 * describe a device's label; they are never a date for this physical batch. */
export function readDeviceProduct(body: unknown, gtin: string): ProductInfo | null {
  const device = record(record(record(body).gudid).device);
  const ids = record(device.identifiers).identifier;
  const identifiers = (Array.isArray(ids) ? ids : [ids]).map(record);
  if (!identifiers.some(id => id.deviceId === gtin && id.deviceIdIssuingAgency === 'GS1')) return null;
  const brand = text(device.brandName, 100);
  const model = text(device.versionModelNumber, 100);
  const description = text(device.deviceDescription, 500);
  const name = [brand, model].filter(Boolean).join(' · ').slice(0, 100) || description.slice(0, 100);
  if (!name) return null;
  const primary = identifiers.find(id => id.deviceIdType === 'Primary' && id.deviceIdIssuingAgency === 'GS1');
  const sourceId = typeof primary?.deviceId === 'string' && /^\d{14}$/.test(primary.deviceId) ? primary.deviceId : gtin;
  return { name, manufacturer: text(device.companyName, 150), model, description, sourceUrl: `https://accessgudid.nlm.nih.gov/devices/${sourceId}` };
}

export async function lookupMedicalProduct(gtin: string, request: typeof fetch = fetch): Promise<ProductLookup> {
  if (!/^\d{14}$/.test(gtin)) return { status: 'unsupported' };
  try {
    // Send only the public product identifier, never a full UDI, lot or user data.
    const response = await request(`https://accessgudid.nlm.nih.gov/api/v3/devices/lookup.json?di=${gtin}`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      cache: 'force-cache',
      next: { revalidate: 86400 },
    });
    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'unavailable' };
    const product = readDeviceProduct(await response.json(), gtin);
    return product ? { status: 'found', product } : { status: 'not_found' };
  } catch { return { status: 'unavailable' }; }
}
