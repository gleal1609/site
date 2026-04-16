import { json, error } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { SLUG_PATH_RE } from '../utils/slug.js';

const MAX_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function sanitizeKey(slug, type, ext) {
  if (!SLUG_PATH_RE.test(slug)) throw new Error('Invalid slug');
  if (!['thumbnail', 'preview'].includes(type)) throw new Error('Invalid type');

  const hash = crypto.randomUUID().slice(0, 8);
  return `projects/${slug}/${type}-${hash}.${ext}`;
}

export async function handleUpload(request, env, ctx) {
  const contentType = request.headers.get('Content-Type') || '';

  let slug, type, file, fileType;

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    slug = formData.get('slug');
    type = formData.get('type');
    file = formData.get('file');
    if (!file || !(file instanceof File)) return error('No file provided', 400);
    fileType = file.type;

    if (file.size > MAX_SIZE) return error(`File exceeds ${MAX_SIZE / 1048576}MB limit`, 400);
  } else {
    return error('Content-Type must be multipart/form-data', 400);
  }

  if (!slug || !type) return error('slug and type fields required', 400);

  const ext = ALLOWED_TYPES[fileType];
  if (!ext) return error(`File type ${fileType} not allowed`, 400);

  let key;
  try {
    key = sanitizeKey(slug, type, ext);
  } catch (e) {
    return error(e.message, 400);
  }

  const arrayBuffer = await file.arrayBuffer();
  await env.MEDIA.put(key, arrayBuffer, {
    httpMetadata: { contentType: fileType },
  });

  logAudit(ctx, env.DB, {
    action: 'upload', targetType: 'media', targetId: key,
    diff: { size: file.size, type: fileType },
  });

  return json({ key, url: `${env.MEDIA_BASE_URL}/${key}` }, 201);
}
