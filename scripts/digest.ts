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

/** Load today's existing data file if it exists */
async function loadTodayData(today: string): Promise<{ articles: any[] } | null> {
  const filePath = path.join(DATA_DIR, `${today}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  const today = getTodayDate();
  console.log(`[digest] === TechDigest — ${today} ===`);

  // Load existing today's data for incremental update
  const existingData = await loadTodayData(today);
  const existingArticles = existingData?.articles || [];
  const existingLinksToday = new Set(existingArticles.map((a: any) => a.link));
  console.log(`[digest] Existing articles today: ${existingArticles.length}`);

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

  // Step 3: Dedup against cross-day AND today's existing articles
  console.log('[digest] Step 3/5: Dedup...');
  const existingLinks = await loadRecentLinks(today, 3);
  const deduped = recent.filter(a => !existingLinks.has(a.link) && !existingLinksToday.has(a.link));
  console.log(`[digest] ${deduped.length} new articles after dedup`);

  if (deduped.length === 0) {
    console.log('[digest] No new articles. Skipping AI calls.');
    // Still rebuild with existing data to ensure site is up to date
    await mkdir(DATA_DIR, { recursive: true });
    const outPath = path.join(DATA_DIR, `${today}.json`);
    await writeFile(outPath, JSON.stringify(existingData, null, 2));
    console.log(`[digest] Done! No changes.`);
    return;
  }

  // Step 4: Score new articles (with retry for failures)
  console.log(`[digest] Step 4/5: AI scoring ${deduped.length} new articles...`);
  let scores = await scoreArticles(deduped);

  const unscoredIndices = deduped.map((_, i) => i).filter(i => !scores.has(i));
  if (unscoredIndices.length > 0) {
    console.log(`[digest] Retrying ${unscoredIndices.length} failed scores...`);
    const retryArticles = unscoredIndices.map(i => deduped[i]);
    const retryScores = await scoreArticles(retryArticles);
    retryScores.forEach((v, retryIdx) => { scores.set(unscoredIndices[retryIdx], v); });
  }

  const scored = deduped.map((article, index) => {
    const s = scores.get(index);
    if (!s) return null;
    const score = s.depth + s.novelty + s.breadth;
    if (score / 3 < 3) return null;
    return { ...article, ...s, score };
  }).filter((a): a is NonNullable<typeof a> => a !== null);

  // Step 5: Summarize articles (with retry for failures)
  console.log(`[digest] Step 5/5: Generating summaries for ${scored.length} new articles...`);
  const indexed = scored.map((a, i) => ({ ...a, index: i, avgScore: a.score / 3 }));
  let summaries = await summarizeArticles(indexed);

  const unsummarizedIndices = indexed.filter(a => (a.avgScore ?? 0) >= 3 && !summaries.has(a.index)).map(a => a.index);
  if (unsummarizedIndices.length > 0) {
    console.log(`[digest] Retrying ${unsummarizedIndices.length} failed summaries...`);
    const retryItems = unsummarizedIndices.map(i => indexed[i]);
    const retrySummaries = await summarizeArticles(retryItems);
    retrySummaries.forEach((v, k) => { summaries.set(k, v); });
  }

  const newArticles = scored.map((a, i) => {
    const sm = summaries.get(i);
    return {
      title: a.title,
      title_zh: sm?.titleZh || a.title,
      link: a.link,
      pub_date: a.pubDate.toISOString(),
      summary: sm?.summary || '',
      source_name: a.sourceName,
      score: a.score,
      depth: a.depth,
      novelty: a.novelty,
      breadth: a.breadth,
      category: a.category,
      keywords: a.keywords,
    };
  });

  // Merge: existing + new, re-sort by score, re-rank
  const merged = [...existingArticles, ...newArticles];
  merged.sort((a: any, b: any) => b.score - a.score);
  const top = merged.slice(0, 100);
  top.forEach((a: any, i: number) => { a.rank = i + 1; });

  // Write JSON
  await mkdir(DATA_DIR, { recursive: true });
  const output = {
    date: today,
    total_feeds: RSS_FEEDS.length,
    success_feeds: successCount,
    total_articles: allArticles.length,
    filtered_articles: recent.length,
    articles: top,
  };

  const outPath = path.join(DATA_DIR, `${today}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`[digest] Written ${outPath}`);
  console.log(`[digest] Done! ${existingArticles.length} existing + ${newArticles.length} new -> ${top.length} total`);
}

main().catch(err => {
  console.error(`[digest] Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
