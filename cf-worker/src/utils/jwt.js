const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function getKey(secret) {
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify'],
  );
}

export async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const segments = [
    base64url(encoder.encode(JSON.stringify(header))),
    base64url(encoder.encode(JSON.stringify(payload))),
  ];
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(segments.join('.')));
  segments.push(base64url(sig));
  return segments.join('.');
}

export async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');

  const key = await getKey(secret);
  const data = encoder.encode(`${parts[0]}.${parts[1]}`);
  const sig = base64urlDecode(parts[2]);
  const valid = await crypto.subtle.verify('HMAC', key, sig, data);
  if (!valid) throw new Error('Invalid signature');

  const payload = JSON.parse(decoder.decode(base64urlDecode(parts[1])));
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new Error('Token expired');
  }
  return payload;
}

export function generateJTI() {
  return crypto.randomUUID();
}
