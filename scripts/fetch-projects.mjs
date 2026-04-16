/**
 * Build-time: fetch published projects from Worker → _data/projects.json
 */
import { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, '_data');
const OUTPUT = join(DATA_DIR, 'projects.json');

const WORKER_URL =
  process.env.WORKER_EXPORT_URL ||
  'https://reverso-cms-api.reverso-cms.workers.dev/api/projects/export';
const BUILD_TOKEN = process.env.CF_BUILD_TOKEN || '';
const CACHE_DIR = process.env.NETLIFY_CACHE_DIR || '';
const CACHE_PATH = CACHE_DIR ? join(CACHE_DIR, '_data', 'projects.json') : '';

const RETRIES = 3;
const BACKOFF = [1000, 3000, 9000];

async function fetchWithRetry() {
  for (let i = 0; i < RETRIES; i++) {
    try {
      console.log(`[fetch-projects] Attempt ${i + 1}/${RETRIES}: ${WORKER_URL}`);
      const res = await fetch(WORKER_URL, {
        headers: {
          Authorization: `Bearer ${BUILD_TOKEN}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (e) {
      console.error(`[fetch-projects] Attempt ${i + 1} failed: ${e.message}`);
      if (i < RETRIES - 1) {
        const wait = BACKOFF[i];
        console.log(`[fetch-projects] Retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  return null;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  let projects = await fetchWithRetry();

  if (projects) {
    const json = JSON.stringify(projects, null, 2);
    writeFileSync(OUTPUT, json, 'utf-8');
    console.log(`[fetch-projects] Wrote ${projects.length} projects to ${OUTPUT}`);

    if (CACHE_PATH) {
      try {
        mkdirSync(dirname(CACHE_PATH), { recursive: true });
        copyFileSync(OUTPUT, CACHE_PATH);
        console.log(`[fetch-projects] Cached to ${CACHE_PATH}`);
      } catch (e) {
        console.warn(`[fetch-projects] Could not cache: ${e.message}`);
      }
    }
    return;
  }

  console.warn('[fetch-projects] WARNING: All fetch attempts failed.');

  if (CACHE_PATH && existsSync(CACHE_PATH)) {
    console.warn(`[fetch-projects] Using cached ${CACHE_PATH}`);
    copyFileSync(CACHE_PATH, OUTPUT);
    return;
  }

  if (existsSync(OUTPUT)) {
    console.warn(`[fetch-projects] Using existing ${OUTPUT}`);
    return;
  }

  console.error('[fetch-projects] FATAL: No data available. Build cannot proceed.');
  process.exit(1);
}

main().catch(e => {
  console.error('[fetch-projects] Fatal error:', e);
  process.exit(1);
});
