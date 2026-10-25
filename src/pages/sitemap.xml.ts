import type { APIRoute } from 'astro';
import { listDigestDates, loadHnArchive, loadHnData } from '../lib/data';

/** Every HN page (including archived items) and every daily digest */
export const GET: APIRoute = ({ site }) => {
  const ids = new Set([...loadHnArchive(), ...(loadHnData()?.items || [])].map(item => item.id));
  const paths = [
    '/hn/',
    ...[...ids].map(id => `/hn/${id}/`),
    ...listDigestDates().map(date => `/day/${date}/`),
  ];
  const urls = paths.map(p => `  <url><loc>${new URL(p, site)}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
