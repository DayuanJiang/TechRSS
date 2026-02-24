import { XMLParser } from 'fast-xml-parser';
import type { Article } from './types';

const FEED_FETCH_TIMEOUT_MS = 15_000;
const FEED_CONCURRENCY = 10;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['item', 'entry'].includes(name),
  trimValues: true,
});

function stripHtml(html: string): string {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .trim();
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function parseAtomEntries(entries: any[], feed: { name: string; htmlUrl: string }): Article[] {
  if (!entries) return [];
  return entries.map(entry => {
    const title = stripHtml(typeof entry.title === 'object' ? entry.title['#text'] : entry.title);

    let link = '';
    if (Array.isArray(entry.link)) {
      const alt = entry.link.find((l: any) => l['@_rel'] === 'alternate');
      link = (alt || entry.link[0])?.['@_href'] || '';
    } else if (typeof entry.link === 'object') {
      link = entry.link['@_href'] || '';
    } else {
      link = String(entry.link || '');
    }

    const pubDateStr = entry.published || entry.updated || '';
    const description = stripHtml(
      typeof entry.summary === 'object' ? entry.summary['#text'] : (entry.summary || entry.content?.['#text'] || entry.content || '')
    );

    return {
      title,
      link,
      pubDate: parseDate(pubDateStr) || new Date(0),
      description: String(description).slice(0, 500),
      sourceName: feed.name,
      sourceUrl: feed.htmlUrl,
    };
  }).filter(a => a.title || a.link);
}

function parseRSSItems(items: any[], feed: { name: string; htmlUrl: string }): Article[] {
  if (!items) return [];
  return items.map(item => {
    const title = stripHtml(typeof item.title === 'object' ? item.title['#text'] : item.title);
    const link = String(item.link || item.guid?.['#text'] || item.guid || '');
    const pubDateStr = item.pubDate || item['dc:date'] || item.date || '';
    const description = stripHtml(
      item.description || item['content:encoded'] || ''
    );

    return {
      title,
      link,
      pubDate: parseDate(pubDateStr) || new Date(0),
      description: String(description).slice(0, 500),
      sourceName: feed.name,
      sourceUrl: feed.htmlUrl,
    };
  }).filter(a => a.title || a.link);
}

function parseFeedXml(xml: string, feed: { name: string; htmlUrl: string }): Article[] {
  const parsed = parser.parse(xml);

  // Atom feed
  if (parsed.feed?.entry) {
    return parseAtomEntries(parsed.feed.entry, feed);
  }

  // RSS 2.0
  if (parsed.rss?.channel?.item) {
    return parseRSSItems(parsed.rss.channel.item, feed);
  }

  // RDF/RSS 1.0
  if (parsed['rdf:RDF']?.item) {
    return parseRSSItems(parsed['rdf:RDF'].item, feed);
  }

  return [];
}

export async function fetchFeed(feed: { name: string; xmlUrl: string; htmlUrl: string }): Promise<Article[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);

    const response = await fetch(feed.xmlUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TechDigest/1.0 (RSS Reader)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const xml = await response.text();
    return parseFeedXml(xml, feed);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('abort')) {
      console.warn(`[digest] x ${feed.name}: ${msg}`);
    } else {
      console.warn(`[digest] x ${feed.name}: timeout`);
    }
    return [];
  }
}

export async function fetchAllFeeds(feeds: Array<{ name: string; xmlUrl: string; htmlUrl: string }>): Promise<{
  articles: Article[];
  successCount: number;
  failCount: number;
}> {
  const allArticles: Article[] = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < feeds.length; i += FEED_CONCURRENCY) {
    const batch = feeds.slice(i, i + FEED_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchFeed));

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allArticles.push(...result.value);
        successCount++;
      } else {
        failCount++;
      }
    }

    const progress = Math.min(i + FEED_CONCURRENCY, feeds.length);
    console.log(`[digest] Progress: ${progress}/${feeds.length} feeds (${successCount} ok, ${failCount} failed)`);
  }

  console.log(`[digest] Fetched ${allArticles.length} articles from ${successCount} feeds (${failCount} failed)`);
  return { articles: allArticles, successCount, failCount };
}
