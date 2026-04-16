export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

export function redirect(url, cookies = []) {
  const headers = new Headers({ Location: url });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}
