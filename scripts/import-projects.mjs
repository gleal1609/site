/**
 * Migração: _projects/*.md → D1 via Worker (POST /api/projects).
 * AUTH_TOKEN: JWT da sessão (cookie HttpOnly __session ou o mesmo valor noutro sítio). Ver import-projects-sheet.mjs.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROJECTS_DIR = join(ROOT, '_projects');

const DRY_RUN = process.argv.includes('--dry-run');
const WORKER_URL = (process.env.WORKER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');

function normalizeSessionJwt(raw) {
  let t = String(raw || '').trim();
  if (t.toLowerCase().startsWith('bearer ')) t = t.slice(7).trim();
  return t;
}
const AUTH_TOKEN = normalizeSessionJwt(process.env.AUTH_TOKEN || '');

function parseFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const lines = match[1].split('\n');
  const data = {};
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    const kvMatch = line.match(/^(\w[\w_]*):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      let val = kvMatch[2].trim();

      if (val === '') {
        currentArray = [];
        data[currentKey] = currentArray;
        continue;
      }

      currentArray = null;
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (/^\d+$/.test(val)) val = parseInt(val, 10);
      data[currentKey] = val;
    } else if (currentArray !== null && line.match(/^\s+-\s+(.*)$/)) {
      let item = line.match(/^\s+-\s+(.*)$/)[1].trim();
      if (item.startsWith('"') && item.endsWith('"')) item = item.slice(1, -1);
      currentArray.push(item);
    }
  }

  return { data, body: match[2] || '' };
}

async function importProject(data, body, slug) {
  const payload = {
    slug,
    title: data.title || slug,
    body_md: body.trim() || null,
    thumbnail: data.thumbnail || null,
    hover_preview: data.hover_preview || null,
    service_types: Array.isArray(data.service_types) ? data.service_types : [],
    client: data.client || null,
    date_mmddyyyy: data.date_mmddyyyy ? String(data.date_mmddyyyy) : null,
    year: data.year || null,
    order: data.order != null && Number(data.order) >= 1 ? Number(data.order) : 1,
    home_size: data.home_size ? String(data.home_size) : '1x1',
    show_on_home: data.show_on_home ? 1 : 0,
    youtube_url: data.youtube_url || null,
    pixieset_url: data.pixieset_url || null,
  };

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would insert: ${slug} — "${payload.title}"`);
    return { status: 'dry-run' };
  }

  const res = await fetch(`${WORKER_URL}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'fetch',
      Authorization: `Bearer ${AUTH_TOKEN}`,
      Cookie: `__session=${AUTH_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (!res.ok) {
    if (res.status === 409) return { status: 'exists', slug };
    throw new Error(`${res.status}: ${result.error || JSON.stringify(result)}`);
  }
  return { status: 'created', slug };
}

async function main() {
  console.log(`Import ${DRY_RUN ? '(DRY RUN)' : ''} from ${PROJECTS_DIR}`);
  console.log(`Worker: ${WORKER_URL}\n`);

  let files;
  try {
    files = readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.md'));
  } catch {
    console.error(`Directory not found: ${PROJECTS_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} markdown files.\n`);

  const stats = { created: 0, exists: 0, errors: 0 };

  for (const file of files.sort()) {
    const slug = basename(file, '.md');
    const content = readFileSync(join(PROJECTS_DIR, file), 'utf-8');
    const { data, body } = parseFrontMatter(content);

    try {
      const result = await importProject(data, body, slug);
      if (result.status === 'created') {
        console.log(`  + ${slug}`);
        stats.created++;
      } else if (result.status === 'exists') {
        console.log(`  = ${slug} (already exists, skipped)`);
        stats.exists++;
      } else {
        stats.created++;
      }
    } catch (e) {
      console.error(`  ! ${slug}: ${e.message}`);
      stats.errors++;
    }
  }

  console.log(`\nDone. Created: ${stats.created}, Existing: ${stats.exists}, Errors: ${stats.errors}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
