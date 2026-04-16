import { json, error } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

const DEBOUNCE_MS = 5 * 60 * 1000;

export async function handleDeploy(env, ctx) {
  if (!env.NETLIFY_DEPLOY_HOOK_URL) {
    return error('Deploy hook not configured', 500);
  }

  const last = await env.DB.prepare(
    'SELECT triggered_at FROM deploy_log ORDER BY id DESC LIMIT 1',
  ).first();

  if (last) {
    const elapsed = Date.now() - new Date(last.triggered_at + 'Z').getTime();
    if (elapsed < DEBOUNCE_MS) {
      const waitSec = Math.ceil((DEBOUNCE_MS - elapsed) / 1000);
      return json({ skipped: true, message: `Deploy debounced. Wait ${waitSec}s.` });
    }
  }

  const res = await fetch(env.NETLIFY_DEPLOY_HOOK_URL, { method: 'POST' });
  if (!res.ok) {
    return error(`Netlify hook returned ${res.status}`, 502);
  }

  await env.DB.prepare('INSERT INTO deploy_log (triggered_at) VALUES (datetime(\'now\'))').run();

  logAudit(ctx, env.DB, {
    action: 'deploy', targetType: 'build', targetId: 'netlify',
  });

  return json({ triggered: true });
}
