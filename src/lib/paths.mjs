const base = (import.meta.env?.BASE_URL || '/snmg-213/').replace(/\/$/, '');
// trailingSlash is 'always', so page paths (no file extension) get their slash before any ?query or #hash.
const withSlash = path => path.replace(/^([^?#]*?)\/?([?#].*)?$/, (match, head, rest = '') => /\.[a-z0-9]+$/i.test(head) ? match : `${head}/${rest}`);
export function withBase(path = '/') {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  path = withSlash(path);
  if (path === `${base}/` || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}
export const repositoryUrl = 'https://github.com/ncueecesnmg/snmg-213';
export const cmsUrl = 'https://snmg-213-admin.ncueecesnmg.workers.dev/';
