/** Match the browser origin to the external Host, not Next's internal URL. */
export function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
      || new URL(request.url).protocol.slice(0, -1);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === host && parsed.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}
