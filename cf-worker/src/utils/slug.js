/** Slug in URL / R2 prefix — allows legacy mixed case from imports. */
export const SLUG_PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

/** New projects (body): lowercase, digits, hyphens only. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

const PATH = /^\/api\/projects\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})$/;

/** Pathname → slug or null (same rule as SLUG_PATH_RE). */
export function matchApiProjectSlug(pathname) {
  return pathname.match(PATH)?.[1] ?? null;
}
