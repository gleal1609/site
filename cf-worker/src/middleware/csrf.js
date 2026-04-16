import { error } from '../utils/response.js';

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

export function csrfMiddleware(request) {
  if (!MUTATING.includes(request.method)) return null;

  const xrw = request.headers.get('X-Requested-With');
  if (xrw !== 'fetch') {
    return error('Missing X-Requested-With header', 403);
  }
  return null;
}
