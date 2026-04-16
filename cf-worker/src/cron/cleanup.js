export async function dailyCleanup(env) {
  const revoked = await env.DB.prepare(
    `DELETE FROM revoked_sessions WHERE revoked_at < datetime('now', '-30 days')`,
  ).run();

  const logins = await env.DB.prepare(
    `DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-1 hour')`,
  ).run();

  const deploys = await env.DB.prepare(
    `DELETE FROM deploy_log WHERE triggered_at < datetime('now', '-30 days')`,
  ).run();

  console.log(`Cleanup: revoked=${revoked.meta.changes}, logins=${logins.meta.changes}, deploys=${deploys.meta.changes}`);
}
