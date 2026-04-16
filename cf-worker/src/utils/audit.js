export function logAudit(ctx, db, { action, targetType, targetId, diff }) {
  const githubId = ctx.user?.sub || 'unknown';
  const stmt = db.prepare(
    `INSERT INTO audit_log (actor_github_id, action, target_type, target_id, diff_summary)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(githubId, action, targetType || null, targetId || null, diff ? JSON.stringify(diff) : null);
  ctx.waitUntil(stmt.run());
}
