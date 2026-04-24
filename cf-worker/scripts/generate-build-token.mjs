#!/usr/bin/env node
/**
 * Gera um JWT para o Netlify chamar GET /api/projects/export.
 * Uso (na pasta cf-worker):
 *   JWT_SECRET="seu_hex_aqui" node scripts/generate-build-token.mjs
 * Opcional: dias de validade (default 365)
 *   JWT_SECRET="..." node scripts/generate-build-token.mjs 365
 *
 * O segredo NÃO é enviado à rede; roda só na sua máquina.
 */
import crypto from 'crypto';

const secret = process.env.JWT_SECRET;
if (!secret || !secret.trim()) {
  console.error('Defina JWT_SECRET no ambiente (mesmo valor que usará no Worker).');
  console.error('Ex.: JWT_SECRET="$(openssl rand -hex 32)" node scripts/generate-build-token.mjs');
  process.exit(1);
}

const days = Math.min(3650, Math.max(1, parseInt(process.argv[2] || '365', 10) || 365));
const now = Math.floor(Date.now() / 1000);
const exp = now + days * 24 * 3600;

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const header = b64url({ alg: 'HS256', typ: 'JWT' });
const payload = b64url({
  scope: 'read:export',
  iat: now,
  exp,
  sub: 'netlify-build',
});

const data = `${header}.${payload}`;
const sig = crypto
  .createHmac('sha256', secret)
  .update(data)
  .digest('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const token = `${data}.${sig}`;
console.log('\nBUILD_TOKEN (copie para .dev.vars, Netlify e wrangler secret):\n');
console.log(token);
console.log(`\nValidade: ${days} dias (exp unix: ${exp})\n`);
