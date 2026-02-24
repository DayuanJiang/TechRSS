import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { RSS_FEEDS } from '../src/lib/feeds';
import { fetchAllFeeds } from '../src/lib/rss';
import { scoreArticles, summarizeArticles } from '../src/lib/ai';

const DATA_DIR = path.join(process.cwd(), 'data');

function getTodayDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

/** Load article links from recent JSON files for dedup */
async function loadRecentLinks(excludeDate: string, days: number): Promise<Set<string>> {
  const links = new Set<string>();
  if (!existsSync(DATA_DIR)) return links;

  const files = await readdir(DATA_DIR);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const date = file.replace('.json', '');
    if (date === excludeDate || date < cutoff) continue;
    const data = JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf-8'));
    for (const a of data.articles || []) {
      links.add(a.link);
    }
  }
  return links;
}

async function main() {
  const today = getTodayDate();
  console.log(`[digest] === TechDigest — ${today} ===`);

  // Step 1: Fetch feeds
  console.log(`[digest] Step 1/5: Fetching ${RSS_FEEDS.length} RSS feeds...`);
  const { articles: allArticles, successCount } = await fetchAllFeeds(RSS_FEEDS);

  if (allArticles.length === 0) {
    console.error('[digest] No articles fetched. Exiting.');
    process.exit(1);
  }

  // Step 2: Filter to last 24h (fallback 48h)
  console.log('[digest] Step 2/5: Filtering to last 24 hours...');
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let recent = allArticles.filter(a => a.pubDate.getTime() > cutoff.getTime());
  console.log(`[digest] ${recent.length} articles within last 24h`);

  if (recent.length === 0) {
    const cutoff48 = new Date(Date.now() - 48 * 60 * 60 * 1000);
    recent = allArticles.filter(a => a.pubDate.getTime() > cutoff48.getTime());
    console.log(`[digest] Fallback to 48h: ${recent.length} articles`);
  }

  if (recent.length === 0) {
    console.error('[digest] No recent articles found. Exiting.');
    process.exit(1);
  }

  // Step 3: Cross-day dedup
  console.log('[digest] Step 3/5: Cross-day dedup...');
  const existingLinks = await loadRecentLinks(today, 3);
  const deduped = recent.filter(a => !existingLinks.has(a.link));
  console.log(`[digest] Removed ${recent.length - deduped.length} duplicates, ${deduped.length} remaining`);

  // Step 4: Score
  console.log(`[digest] Step 4/5: AI scoring ${deduped.length} articles...`);
  const scores = await scoreArticles(deduped);

  const scored = deduped.map((article, index) => {
    const s = scores.get(index) || { depth: 5, novelty: 5, breadth: 5, category: 'other', keywords: [] };
    return { ...article, ...s, score: s.depth + s.novelty + s.breadth };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 100);

  console.log(`[digest] Top ${top.length} selected (score range: ${top[top.length - 1]?.score || 0}-${top[0]?.score || 0})`);

  // Step 5: Summarize
  console.log(`[digest] Step 5/5: Generating summaries for ${top.length} articles...`);
  const indexed = top.map((a, i) => ({ ...a, index: i }));
  const summaries = await summarizeArticles(indexed);

  const final = top.map((a, i) => {
    const sm = summaries.get(i) || { titleZh: a.title, summary: a.description.slice(0, 200), reason: '' };
    return { ...a, ...sm, rank: i + 1 };
  });

  // Write JSON
  await mkdir(DATA_DIR, { recursive: true });
  const output = {
    date: today,
    total_feeds: RSS_FEEDS.length,
    success_feeds: successCount,
    total_articles: allArticles.length,
    filtered_articles: recent.length,
    articles: final.map(a => ({
      title: a.title,
      title_zh: a.titleZh || a.title,
      link: a.link,
      pub_date: a.pubDate.toISOString(),
      summary: a.summary,
      reason: a.reason,
      source_name: a.sourceName,
      score: a.score,
      depth: a.depth,
      novelty: a.novelty,
      breadth: a.breadth,
      category: a.category,
      keywords: a.keywords,
      rank: a.rank,
    })),
  };

  const outPath = path.join(DATA_DIR, `${today}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`[digest] Written ${outPath}`);
  console.log(`[digest] Done! ${successCount} feeds -> ${allArticles.length} articles -> ${recent.length} recent -> ${final.length} saved`);
}

main().catch(err => {
  console.error(`[digest] Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
