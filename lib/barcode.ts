export const CAMERA_PREFERENCE = { facingMode: 'environment' } as const;

// Omitting qrbox scans the whole preview. These are preferences, so phones that
// cannot supply 1080p can still open their camera at a supported resolution.
export const CAMERA_SCAN_CONFIG = {
  fps: 5,
  videoConstraints: {
    facingMode: 'environment',
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
} as const;

export function normalizeBarcode(value: string): string {
  const code = value.trim();
  if (!code) throw new Error('바코드나 QR 코드값을 입력해 주세요.');
  if (code.length > 100) throw new Error('이 코드는 너무 길어요. 100자 이하의 물품 코드로 등록해 주세요.');
  if (/[\u0000-\u001f\u007f]/.test(code)) throw new Error('여러 줄의 내용 대신 물품의 식별 코드만 입력해 주세요.');
  return code;
}

export type ScannedCode = {
  barcode: string;
  display?: string;
  expiry?: string;
  productionDate?: string;
  lot?: string;
  serial?: string;
};

function gs1Date(value: string, endOfMonth: boolean): string | undefined {
  if (!/^\d{6}$/.test(value)) return;
  let year = 2000 + Number(value.slice(0, 2));
  const currentYear = new Date().getUTCFullYear();
  // GS1's two-digit year window is 49 years back and 50 years forward.
  while (year < currentYear - 49) year += 100;
  while (year > currentYear + 50) year -= 100;
  const month = Number(value.slice(2, 4));
  let day = Number(value.slice(4));
  if (month < 1 || month > 12) return;
  if (day === 0 && endOfMonth) day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, month - 1, day));
  if (day < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function validGtin(value: string) {
  if (!/^\d{14}$/.test(value)) return false;
  let total = 0;
  for (let index = 0; index < 13; index++) total += Number(value[index]) * (index % 2 === 0 ? 3 : 1);
  return (10 - total % 10) % 10 === Number(value[13]);
}

/** Conservative GS1 subset: never guess where an unseparated lot/serial ends. */
function parseGs1(value: string): ScannedCode | null {
  if (value.length > 512) return null;
  const code = value.trim().replace(/^\](?:d2|Q3|C1)/, '').replace(/^\x1d/, '');
  const fields = new Map<string, string>();
  const fixed: Record<string, number> = { '01': 14, '11': 6, '17': 6 };
  if (code.startsWith('(01)')) {
    const markers = [...code.matchAll(/\((\d{2,4})\)/g)];
    for (let index = 0; index < markers.length; index++) {
      const marker = markers[index];
      const ai = marker[1];
      if (!(ai in fixed) && ai !== '10' && ai !== '21') return null;
      if (fields.has(ai)) return null;
      fields.set(ai, code.slice(marker.index! + marker[0].length, markers[index + 1]?.index ?? code.length).trim());
    }
  } else {
    if (!code.startsWith('01')) return null;
    let offset = 0;
    while (offset < code.length) {
      const ai = code.slice(offset, offset + 2);
      if (fields.has(ai)) return null;
      offset += 2;
      if (ai in fixed) {
        fields.set(ai, code.slice(offset, offset + fixed[ai]));
        offset += fixed[ai];
      } else if (ai === '10' || ai === '21') {
        const separator = code.indexOf('\x1d', offset);
        const end = separator < 0 ? code.length : separator;
        fields.set(ai, code.slice(offset, end));
        offset = end;
      } else return null;
      if (code[offset] === '\x1d') offset++;
    }
  }
  const gtin = fields.get('01') || '';
  if (!validGtin(gtin)) return null;
  for (const [ai, data] of fields) {
    if (ai in fixed) {
      if (!new RegExp(`^\\d{${fixed[ai]}}$`).test(data)) return null;
    } else if (data.length < 1 || data.length > 20 || /[\x00-\x1f\x7f]/.test(data)) return null;
  }
  const expiry = fields.has('17') ? gs1Date(fields.get('17')!, true) : undefined;
  const productionDate = fields.has('11') ? gs1Date(fields.get('11')!, false) : undefined;
  if (fields.has('17') && !expiry) return null;
  const display = [...fields].map(([ai, data]) => `(${ai})${data}`).join('');
  return { barcode: gtin, display, expiry, productionDate, lot: fields.get('10'), serial: fields.get('21') };
}

export function readScannedCode(value: string): ScannedCode {
  const gs1 = parseGs1(value);
  if (gs1) { normalizeBarcode(gs1.display!); return gs1; }
  return { barcode: normalizeBarcode(value) };
}

// Make FNC1 separators readable/editable without stripping their field boundaries.
export function normalizeScannedValue(value: string): string {
  const scanned = readScannedCode(value);
  return scanned.display || scanned.barcode;
}

export function applyScannedCode<T extends { barcode: string; expiry: string | null; note: string }>(form: T, scanned: ScannedCode): T {
  const details = [scanned.lot && `제조번호(LOT): ${scanned.lot}`, scanned.productionDate && `제조일: ${scanned.productionDate}`, scanned.serial && `일련번호: ${scanned.serial}`].filter(Boolean).join('\n');
  return { ...form, barcode: scanned.barcode, expiry: form.expiry || scanned.expiry || '', note: form.note || details };
}

export function findBarcodeMatches<T extends { barcode: string }>(items: readonly T[], value: string): T[] {
  const code = readScannedCode(value).barcode;
  return items.filter(item => (parseGs1(item.barcode)?.barcode || item.barcode.trim()) === code);
}

export function cameraErrorMessage(error: unknown): string {
  const description = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/NotAllowed|Permission|denied|SecurityError/i.test(description)) return '카메라 사용이 허용되지 않았어요. 브라우저의 카메라 권한을 허용하거나 사진을 선택해 주세요.';
  if (/NotFound|DevicesNotFound|Overconstrained/i.test(description)) return '사용할 카메라를 찾지 못했어요. 사진 찍기나 사진 선택을 이용해 주세요.';
  if (/NotReadable|TrackStart|in use/i.test(description)) return '다른 앱에서 카메라를 사용 중일 수 있어요. 다른 앱을 닫고 다시 시도해 주세요.';
  return '카메라를 열지 못했어요. 휴대폰 기본 브라우저에서 다시 열거나 사진 선택을 이용해 주세요.';
}
