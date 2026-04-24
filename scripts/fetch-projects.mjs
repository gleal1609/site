/**
 * Build-time: fetch all projects + site settings from Worker → _data/*.json
 * (A migration 0005 removeu `published` / `show_on_home`: a Home mostra tudo.)
 */
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, '_data');
const OUTPUT_PROJECTS = join(DATA_DIR, 'projects.json');
const OUTPUT_SITE_SETTINGS = join(DATA_DIR, 'site-settings.json');

const WORKER_EXPORT_URL =
  process.env.WORKER_EXPORT_URL ||
  'https://reverso-cms-api.reverso-cms.workers.dev/api/projects/export';

function siteSettingsExportUrl() {
  if (process.env.WORKER_SITE_SETTINGS_EXPORT_URL) {
    return process.env.WORKER_SITE_SETTINGS_EXPORT_URL;
  }
  try {
    const u = new URL(WORKER_EXPORT_URL);
    u.pathname = '/api/site-settings/export';
    return u.toString();
  } catch {
    return 'https://reverso-cms-api.reverso-cms.workers.dev/api/site-settings/export';
  }
}

const SETTINGS_URL = siteSettingsExportUrl();
const BUILD_TOKEN = process.env.CF_BUILD_TOKEN || '';
const CACHE_DIR = process.env.NETLIFY_CACHE_DIR || '';
const CACHE_PATH = CACHE_DIR ? join(CACHE_DIR, '_data', 'projects.json') : '';
const CACHE_SETTINGS_PATH = CACHE_DIR ? join(CACHE_DIR, '_data', 'site-settings.json') : '';

const RETRIES = 3;
const BACKOFF = [1000, 3000, 9000];

async function fetchJsonWithRetry(url, label) {
  for (let i = 0; i < RETRIES; i++) {
    try {
      console.log(`[fetch-projects] ${label} attempt ${i + 1}/${RETRIES}: ${url}`);
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${BUILD_TOKEN}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (e) {
      console.error(`[fetch-projects] ${label} attempt ${i + 1} failed: ${e.message}`);
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

  const [projects, siteSettings] = await Promise.all([
    fetchJsonWithRetry(WORKER_EXPORT_URL, 'projects'),
    fetchJsonWithRetry(SETTINGS_URL, 'site-settings'),
  ]);

  if (projects) {
    const json = JSON.stringify(projects, null, 2);
    writeFileSync(OUTPUT_PROJECTS, json, 'utf-8');
    console.log(`[fetch-projects] Wrote ${projects.length} projects to ${OUTPUT_PROJECTS}`);

    if (CACHE_PATH) {
      try {
        mkdirSync(dirname(CACHE_PATH), { recursive: true });
        copyFileSync(OUTPUT_PROJECTS, CACHE_PATH);
        console.log(`[fetch-projects] Cached to ${CACHE_PATH}`);
      } catch (e) {
        console.warn(`[fetch-projects] Could not cache projects: ${e.message}`);
      }
    }
  } else {
    console.warn('[fetch-projects] WARNING: All project export attempts failed.');
    if (CACHE_PATH && existsSync(CACHE_PATH)) {
      console.warn(`[fetch-projects] Using cached ${CACHE_PATH}`);
      copyFileSync(CACHE_PATH, OUTPUT_PROJECTS);
    } else if (existsSync(OUTPUT_PROJECTS)) {
      console.warn(`[fetch-projects] Using existing ${OUTPUT_PROJECTS}`);
    } else {
      console.error('[fetch-projects] FATAL: No projects data available. Build cannot proceed.');
      process.exit(1);
    }
  }

  if (siteSettings && typeof siteSettings === 'object') {
    writeFileSync(OUTPUT_SITE_SETTINGS, JSON.stringify(siteSettings, null, 2), 'utf-8');
    console.log(`[fetch-projects] Wrote site settings to ${OUTPUT_SITE_SETTINGS}`);
    if (CACHE_SETTINGS_PATH) {
      try {
        mkdirSync(dirname(CACHE_SETTINGS_PATH), { recursive: true });
        copyFileSync(OUTPUT_SITE_SETTINGS, CACHE_SETTINGS_PATH);
      } catch (e) {
        console.warn(`[fetch-projects] Could not cache site-settings: ${e.message}`);
      }
    }
  } else {
    console.warn('[fetch-projects] WARNING: Site settings export failed; using fallback empty object.');
    const fallback = { hero_video: null };
    if (existsSync(OUTPUT_SITE_SETTINGS)) {
      console.warn(`[fetch-projects] Keeping existing ${OUTPUT_SITE_SETTINGS}`);
    } else {
      writeFileSync(OUTPUT_SITE_SETTINGS, JSON.stringify(fallback, null, 2), 'utf-8');
      console.log(`[fetch-projects] Wrote fallback site settings to ${OUTPUT_SITE_SETTINGS}`);
    }
  }
}

main().catch(e => {
  console.error('[fetch-projects] Fatal error:', e);
  process.exit(1);
});
