import { json, error } from '../utils/response.js';

export async function handleHealth(env) {
  try {
    await env.DB.prepare('SELECT 1').first();
    return json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (e) {
    return error('D1 unreachable: ' + e.message, 503);
  }
}
