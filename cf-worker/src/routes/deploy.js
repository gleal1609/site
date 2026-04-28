import { json, error } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

const DEBOUNCE_MS = 5 * 60 * 1000;

/** URL do POST ao build hook com `trigger_branch` (Netlify sobrescreve a branch configurada na criação do hook). */
function netlifyDeployHookRequestUrl(rawUrl, branch) {
  const u = String(rawUrl || '').trim();
  if (!u) return null;
  const b = String(branch ?? 'main').trim() || 'main';
  try {
    const url = new URL(u);
    url.searchParams.set('trigger_branch', b);
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Lógica partilhada: POST ao build hook Netlify + deploy_log + audit.
 * Usada por POST /api/deploy e por rotas que devem disparar deploy sem depender do admin (ex. reorder).
 *
 * @returns {Promise<{ kind: 'triggered' } | { kind: 'skipped', message: string } | { kind: 'not_configured' } | { kind: 'invalid_hook_url' } | { kind: 'netlify_error', status: number }>}
 */
export async function runDeployHook(env, ctx) {
  if (!env.NETLIFY_DEPLOY_HOOK_URL) {
    return { kind: 'not_configured' };
  }

  const hookUrl = netlifyDeployHookRequestUrl(
    env.NETLIFY_DEPLOY_HOOK_URL,
    env.NETLIFY_DEPLOY_BRANCH,
  );
  if (!hookUrl) {
    return { kind: 'invalid_hook_url' };
  }

  const last = await env.DB.prepare(
    'SELECT triggered_at FROM deploy_log ORDER BY id DESC LIMIT 1',
  ).first();

  if (last) {
    const elapsed = Date.now() - new Date(last.triggered_at + 'Z').getTime();
    if (elapsed < DEBOUNCE_MS) {
      const waitSec = Math.ceil((DEBOUNCE_MS - elapsed) / 1000);
      return {
        kind: 'skipped',
        message: `Deploy debounced. Wait ${waitSec}s.`,
      };
    }
  }

  const res = await fetch(hookUrl, { method: 'POST' });
  if (!res.ok) {
    return { kind: 'netlify_error', status: res.status };
  }

  await env.DB.prepare('INSERT INTO deploy_log (triggered_at) VALUES (datetime(\'now\'))').run();

  logAudit(ctx, env.DB, {
    action: 'deploy', targetType: 'build', targetId: 'netlify',
  });

  return { kind: 'triggered' };
}

export async function handleDeploy(env, ctx) {
  const out = await runDeployHook(env, ctx);
  if (out.kind === 'not_configured') {
    return error('Deploy hook not configured', 500);
  }
  if (out.kind === 'invalid_hook_url') {
    return error('NETLIFY_DEPLOY_HOOK_URL is invalid', 500);
  }
  if (out.kind === 'skipped') {
    return json({ skipped: true, message: out.message });
  }
  if (out.kind === 'netlify_error') {
    return error(`Netlify hook returned ${out.status}`, 502);
  }
  return json({ triggered: true });
}
