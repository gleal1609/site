/**
 * Importa projetos a partir de `_projects/projects_sheet.tsv` (recomendado) ou `.csv`.
 * TSV: uma linha = um registo, TAB entre colunas (evita vírgulas dentro das células).
 *
 * Colunas da planilha → D1 / API:
 *   LINK DRIVE → prefixo YYMMDD + nome ficheiro → date_mmddyyyy, year, slug
 *   NOME DO PROJETO → title
 *   CLIENTE → client
 *   SERVIÇO → service_types (vírgula / ; / |)
 *   Column 11 → description (+ body_md com título + descrição)
 *   LINK YOUTUBE → youtube_url (thumbnail YouTube se Link Thumbnail vazio)
 *   LINK PIXIESET, LINK THUMBNAIL, LINK VIDEO PREVIEW (5s) → idem
 *
 * Uso:
 *   node scripts/import-projects-sheet.mjs --dry-run
 *   SHEET_PATH=_projects/projects_sheet.tsv WORKER_URL=... AUTH_TOKEN=... node scripts/import-projects-sheet.mjs
 *
 * AUTH_TOKEN: JWT da sessão (mesmo valor do cookie HttpOnly __session). Pode colar com ou sem prefixo "Bearer ".
 * O Worker aceita Cookie __session ou Authorization: Bearer — o script envia os dois.
 * Onde obter: DevTools → Rede → um pedido GET/POST ao WORKER_URL → Cabeçalhos do pedido → Cookie: __session=...
 * (em Cookies por origem, escolhe o host do Worker, não só o do site estático). Não use segredos de .dev.vars aqui.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_SHEET = join(ROOT, '_projects', 'projects_sheet.tsv');

const DRY_RUN = process.argv.includes('--dry-run');
const argvPath = process.argv.find((a, i) => i > 1 && !a.startsWith('--'));
const SHEET_PATH = process.env.SHEET_PATH || argvPath || DEFAULT_SHEET;
const WORKER_URL = (process.env.WORKER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');

function normalizeSessionJwt(raw) {
  let t = String(raw || '').trim();
  if (t.toLowerCase().startsWith('bearer ')) t = t.slice(7).trim();
  return t;
}
const AUTH_TOKEN = normalizeSessionJwt(process.env.AUTH_TOKEN || '');

const SIZE_OPTIONS = ['1x1', '1x2', '2x1', '2x2'];

function isTsvPath(p) {
  return String(p || '').toLowerCase().endsWith('.tsv');
}

/** TSV: uma linha = um registo; ignora linhas vazias; células com trim. */
function parseTSV(text) {
  const raw = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows = [];
  for (const line of raw) {
    if (!line.trim()) continue;
    rows.push(line.split('\t').map((c) => String(c).trim()));
  }
  return rows;
}

/**
 * CSV legado: export do Sheets por vezes parte uma célula em várias linhas físicas.
 * Junta linhas que não começam um novo registo (novo registo = "YYMMDD_ após aspas).
 */
function stitchMultilineCsvRows(text) {
  const raw = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!raw.length) return text;
  const out = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const L = raw[i];
    if (/^\s*"\d{6}_/.test(L)) out.push(L);
    else out[out.length - 1] += `\n${L}`;
  }
  return out.join('\n');
}

/** Parser CSV (RFC 4180): campos entre aspas podem conter quebras de linha e vírgulas. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  const s = text.replace(/^\uFEFF/, '');

  const flushRow = () => {
    row.push(field);
    field = '';
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const n = s[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') {
        field += '"';
        i++;
        continue;
      }
      if (c === '"') {
        inQ = false;
        continue;
      }
      field += c;
      continue;
    }
    switch (c) {
      case '"':
        inQ = true;
        break;
      case ',':
        row.push(field);
        field = '';
        break;
      case '\n':
        flushRow();
        break;
      case '\r':
        if (n === '\n') i++;
        flushRow();
        break;
      default:
        field += c;
    }
  }
  if (inQ) throw new Error('CSV: aspas não fechadas');
  if (field !== '' || row.length > 0) {
    row.push(field);
    field = '';
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
  }
  return rows;
}

/** Cabeçalhos da planilha (primeira linha) → chaves internas. */
function mapHeader(cell) {
  const k = String(cell || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u2060/g, '');
  const aliases = {
    'link drive': 'link_drive',
    'nome do projeto': 'title',
    'cliente': 'client',
    'servico': 'service_types',
    'titulo_youtube': 'youtube_title',
    'titulo youtube': 'youtube_title',
    'column 11': 'description',
    'link youtube': 'youtube_url',
    'palavras chave': 'keywords',
    'link pixieset': 'pixieset_url',
    'link thumbnail': 'thumbnail',
    'link video preview (5s)': 'hover_preview',
  };
  const underscored = k.replace(/\s+/g, '_');
  return aliases[k] || aliases[underscored] || underscored;
}

/** Uma linha física sem quebras; vírgulas e aspas RFC. */
function parseCSVLineSimple(line) {
  const row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const n = line[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') {
        field += '"';
        i++;
        continue;
      }
      if (c === '"') {
        inQ = false;
        continue;
      }
      field += c;
      continue;
    }
    if (c === '"') {
      inQ = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    field += c;
  }
  row.push(field);
  return row;
}

/**
 * Export do Sheets por vezes coloca a linha inteira numa única célula/ coluna CSV.
 * Detecta `.mp4,` / `.MP4,` após o nome do ficheiro e re-parseia o restante.
 */
function expandSingleColumnRow(cells) {
  if (cells.length !== 1) return cells;
  const big = String(cells[0] || '').trim();
  if (!big.startsWith('"') && !/^\d{6}_/.test(big)) return cells;
  const inner = big.replace(/^"|"$/g, '');
  let cut = -1;
  const m = inner.match(/\.(?:mp4|MP4|MOV)(?=,)/i);
  if (m) cut = m.index + m[0].length;
  else {
    const c = inner.indexOf(',');
    if (c > 10) cut = c;
  }
  if (cut < 0) return cells;
  const link_drive = inner.slice(0, cut);
  const tail = inner.slice(cut + 1);
  if (!tail) return [link_drive];
  const rest = parseCSVLineSimple(tail);
  return [link_drive, ...rest];
}

function parseRows(text, filePath) {
  const useTsv = isTsvPath(filePath);
  const table = useTsv ? parseTSV(text) : parseCSV(stitchMultilineCsvRows(text));
  if (!table.length) return [];
  const headers = table[0].map(mapHeader);
  const hc = headers.length;
  const out = [];
  for (let r = 1; r < table.length; r++) {
    let line = table[r].map((c) => String(c).trim());
    if (!line || !line.some((c) => c)) continue;
    if (!useTsv) line = expandSingleColumnRow(line);
    while (line.length < hc) line.push('');
    if (line.length > hc) line = line.slice(0, hc);
    const obj = {};
    headers.forEach((h, j) => {
      if (h) obj[h] = line[j] != null ? line[j] : '';
    });
    const t = (obj.title || '').trim();
    const ld = (obj.link_drive || '').trim();
    if (!t && !ld) continue;
    out.push(obj);
  }
  return out;
}

const SERVICE_ALIASES = {
  corporativo: 'EVENTO CORPORATIVO',
  'festivais e eventos': 'FESTIVAIS & EVENTOS',
};

function normalizeServiceToken(raw) {
  const t = String(raw || '').trim().replace(/\u2060/g, '');
  if (!t) return null;
  const low = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (SERVICE_ALIASES[low]) return SERVICE_ALIASES[low];
  return t;
}

function parseServiceTypesCell(raw) {
  if (!raw) return [];
  const parts = raw.split(/[,;|]/).map((x) => normalizeServiceToken(x)).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const k = p.trim();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** YYMMDD no início de LINK DRIVE (ex.: 260214_...) → { date_mmddyyyy, year } */
function parseDrivePrefix(linkDrive) {
  const s = String(linkDrive || '').trim().split('\n')[0];
  const m = s.match(/^(\d{2})(\d{2})(\d{2})[_\s-]/);
  if (!m) return { date_mmddyyyy: null, year: null };
  const yy = parseInt(m[1], 10);
  const mm = m[2];
  const dd = m[3];
  const year = 2000 + yy;
  const date_mmddyyyy = `${mm}${dd}${year}`;
  return { date_mmddyyyy, year };
}

function slugFromDrive(linkDrive) {
  const s = String(linkDrive || '').trim().split('\n')[0];
  if (!s) return null;
  const noExt = s.replace(/\.(mp4|mov|MP4|MOV|webm)$/i, '');
  return toApiSlug(noExt.replace(/[^a-zA-Z0-9_-]+/g, '-'));
}

function slugifyPart(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function toApiSlug(s) {
  let out = slugifyPart(s).replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  out = out.slice(0, 128);
  if (!out) return null;
  if (!/^[a-z0-9]/.test(out)) out = `p-${out}`.replace(/^-+/, '');
  return out;
}

function youtubeVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  let m = u.match(/youtube\.com\/shorts\/([^?&/]+)/i);
  if (m) return m[1];
  m = u.match(/[?&]v=([^&]+)/i);
  if (m) return m[1];
  m = u.match(/youtu\.be\/([^?&/]+)/i);
  if (m) return m[1];
  return null;
}

function youtubeThumbUrl(url) {
  const id = youtubeVideoId(url);
  if (!id) return null;
  return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
}

function pickHomeSize(seed) {
  return SIZE_OPTIONS[Math.abs(seed) % SIZE_OPTIONS.length];
}

function buildBodyMd(title, description) {
  const desc = (description || '').trim();
  const t = (title || '').trim();
  if (!desc && !t) return '';
  let md = `# ${t}\n\n`;
  if (desc) md += `${desc}\n`;
  return md;
}

function rowToPayload(row, index1) {
  const title =
    (row.title || '').trim() ||
    (row.youtube_title || '').trim() ||
    (row.link_drive || '').split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ||
    '';
  if (!title) throw new Error('NOME DO PROJETO vazio (e sem Título YouTube / ficheiro)');

  const slug = slugFromDrive(row.link_drive) || toApiSlug(`${title}-${row.client || 'x'}`);
  if (!slug) throw new Error('slug inválido');

  const { date_mmddyyyy, year } = parseDrivePrefix(row.link_drive);
  const description = (row.description || '').trim();
  const body_md = buildBodyMd(title, description);

  const yt = (row.youtube_url || '').trim();
  const thumbCell = (row.thumbnail || '').trim();
  const thumbnail = thumbCell || youtubeThumbUrl(yt) || null;
  const hover_preview = (row.hover_preview || '').trim() || null;

  return {
    slug,
    title,
    body_md: body_md || null,
    description: description || null,
    thumbnail,
    hover_preview,
    service_types: parseServiceTypesCell(row.service_types),
    client: (row.client || '').trim() || null,
    date_mmddyyyy: date_mmddyyyy || null,
    year: year != null ? year : null,
    show_on_home: true,
    order: index1,
    home_size: pickHomeSize(index1 + title.length),
    youtube_url: yt || null,
    pixieset_url: (row.pixieset_url || '').trim() || null,
    published: true,
  };
}

async function postProject(payload) {
  if (DRY_RUN) {
    console.log(
      `  [DRY-RUN] ${payload.order}\t${payload.slug}\t${payload.title}\tdate=${payload.date_mmddyyyy}\tyear=${payload.year}\tservices=${payload.service_types.join('; ')}`,
    );
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
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409) return { status: 'exists', slug: payload.slug };
    throw new Error(`${res.status}: ${result.error || JSON.stringify(result)}`);
  }
  return { status: 'created', slug: payload.slug };
}

async function main() {
  const path = resolve(SHEET_PATH);
  if (!existsSync(path)) {
    console.error(`Ficheiro não encontrado: ${path}`);
    process.exit(1);
  }
  if (!DRY_RUN && !AUTH_TOKEN) {
    console.error(
      'Defina AUTH_TOKEN: JWT da sessão (igual ao valor do cookie __session). Ver comentário no topo do script ou Rede → pedido à API → Cookie.',
    );
    process.exit(1);
  }

  const raw = readFileSync(path, 'utf-8');
  const records = parseRows(raw, path);
  console.log(`Ficheiro: ${path}`);
  console.log(`Formato: ${isTsvPath(path) ? 'TSV' : 'CSV'}`);
  console.log(`Linhas de dados: ${records.length}`);
  console.log(`Worker: ${WORKER_URL} ${DRY_RUN ? '(dry-run)' : ''}\n`);

  if (DRY_RUN && records[0]) {
    console.log('Chaves da 1.ª linha:', Object.keys(records[0]).join(', '));
    console.log('');
  }

  const stats = { created: 0, exists: 0, errors: 0 };

  for (let i = 0; i < records.length; i++) {
    try {
      const payload = rowToPayload(records[i], i + 1);
      const r = await postProject(payload);
      if (r.status === 'created' || r.status === 'dry-run') {
        if (r.status === 'created') console.log(`  + ${payload.slug}`);
        stats.created++;
      } else if (r.status === 'exists') {
        console.log(`  = ${payload.slug} (já existe)`);
        stats.exists++;
      }
    } catch (e) {
      console.error(`  ! linha ${i + 2}: ${e.message}`);
      stats.errors++;
    }
  }

  console.log(`\nFeito. Criados: ${stats.created}, Já existiam: ${stats.exists}, Erros: ${stats.errors}`);
  if (DRY_RUN) {
    console.log(
      '\nPara importar de verdade:\n  SHEET_PATH=_projects/projects_sheet.tsv WORKER_URL=https://…workers.dev AUTH_TOKEN=<jwt> node scripts/import-projects-sheet.mjs',
    );
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
