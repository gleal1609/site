export function corsMiddleware(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

  if (env.DEV_ORIGINS) {
    allowed.push(...env.DEV_ORIGINS.split(',').map(s => s.trim()));
  }

  const isAllowed = allowed.includes(origin);
  if (origin && !isAllowed) {
    console.warn('[cors] disallowed Origin:', origin);
  }
  const headers = {
    'Access-Control-Allow-Origin': isAllowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  return { corsHeaders: headers, originAllowed: isAllowed };
}
