/** Next may normalize Request.url to localhost; preserve the external Host. */
export function requestOrigin(request: Request) {
  const internal = new URL(request.url);
  const host = request.headers.get('host') || internal.host;
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const protocol = forwardedProtocol === 'https' || forwardedProtocol === 'http'
    ? `${forwardedProtocol}:` : internal.protocol;
  try {
    const external = new URL(`${protocol}//${host}`);
    if (external.host !== host.toLowerCase() || external.username || external.password) return internal.origin;
    return external.origin;
  } catch {
    return internal.origin;
  }
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !!origin && !!request.headers.get('host') && origin === requestOrigin(request);
}
