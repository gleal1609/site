const MAX_BACKUPS = 12;

export async function weeklyBackup(env) {
  const { results } = await env.DB.prepare('SELECT * FROM projects').all();
  const date = new Date().toISOString().slice(0, 10);
  const key = `backups/projects-${date}.json`;

  await env.MEDIA.put(key, JSON.stringify(results, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  const listed = await env.MEDIA.list({ prefix: 'backups/projects-' });
  const sorted = listed.objects.sort((a, b) => b.key.localeCompare(a.key));
  if (sorted.length > MAX_BACKUPS) {
    const toDelete = sorted.slice(MAX_BACKUPS);
    await Promise.all(toDelete.map(obj => env.MEDIA.delete(obj.key)));
  }

  console.log(`Backup complete: ${key} (${results.length} projects)`);
}
