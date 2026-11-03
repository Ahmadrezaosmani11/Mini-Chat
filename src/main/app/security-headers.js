export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

export function applySecurityHeaders(reply, { api }) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
  if (api) reply.header('Cache-Control', 'no-store');
}
