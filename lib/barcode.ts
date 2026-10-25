export const CAMERA_PREFERENCE = { facingMode: 'environment' } as const;

export function normalizeBarcode(value: string): string {
  const code = value.trim();
  if (!code) throw new Error('바코드나 QR 코드값을 입력해 주세요.');
  if (code.length > 100) throw new Error('이 코드는 너무 길어요. 100자 이하의 물품 코드로 등록해 주세요.');
  if (/[\u0000-\u001f\u007f]/.test(code)) throw new Error('여러 줄의 내용 대신 물품의 식별 코드만 입력해 주세요.');
  return code;
}

export function findBarcodeMatches<T extends { barcode: string }>(items: readonly T[], value: string): T[] {
  const code = normalizeBarcode(value);
  return items.filter(item => item.barcode.trim() === code);
}

export function cameraErrorMessage(error: unknown): string {
  const description = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/NotAllowed|Permission|denied|SecurityError/i.test(description)) return '카메라 사용이 허용되지 않았어요. 브라우저의 카메라 권한을 허용하거나 사진을 선택해 주세요.';
  if (/NotFound|DevicesNotFound|Overconstrained/i.test(description)) return '사용할 카메라를 찾지 못했어요. 사진 찍기나 사진 선택을 이용해 주세요.';
  if (/NotReadable|TrackStart|in use/i.test(description)) return '다른 앱에서 카메라를 사용 중일 수 있어요. 다른 앱을 닫고 다시 시도해 주세요.';
  return '카메라를 열지 못했어요. 휴대폰 기본 브라우저에서 다시 열거나 사진 선택을 이용해 주세요.';
}
