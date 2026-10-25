import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fetchWithPlaywright, closeBrowser } from './fetch-content';
import { summarizeArticle } from '../src/lib/ai';

const DATA_DIR = path.join(process.cwd(), 'data');
const HN_FILE = path.join(DATA_DIR, 'hn.json');
// One file per item that has been on the list, so its page stays after it drops off
const ARCHIVE_DIR = path.join(DATA_DIR, 'hn-archive');
const NH_API = 'https://api.newshacker.me';
const LIST_SIZE = 50;

interface NhListItem {
  id: number;
  by: string;
  title: string;
  url?: string;
  score: number;
  createdAt: number;
  aiSummary?: {
    emoji?: string;
    chinese_title?: string;
    sarcastic_question?: string;
    context?: string;
    discussion_overview?: { category: string; summary: string; supportid?: string[] }[];
    terminologies?: { term: string; explanation: string }[];
  };
  aisummary?: NhListItem['aiSummary'];
  articleSummary?: string;
  classifications?: { tags?: string[] };
  detail?: Record<string, unknown>;
}

interface StoredData {
  updatedAt: string;
  items: NhListItem[];
}

async function loadExisting(): Promise<Map<number, NhListItem>> {
  const map = new Map<number, NhListItem>();
  if (!existsSync(HN_FILE)) return map;
  try {
    const data: StoredData = JSON.parse(await readFile(HN_FILE, 'utf-8'));
    for (const item of data.items || []) {
      map.set(item.id, item);
    }
  } catch { /* ignore */ }
  return map;
}

async function fetchDetail(id: number): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${NH_API}/item/${id}`);
    if (!r.ok) return null;
    return await r.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main() {
  try {
  console.log('[hn] Fetching top stories from newshacker.me...');
  const r = await fetch(`${NH_API}/list?page=1&pageSize=${LIST_SIZE}&minScore=100`);
  if (!r.ok) {
    console.error(`[hn] API returned ${r.status}`);
    process.exit(1);
  }
  const data = await r.json() as { items: NhListItem[] };
  const items = data.items || [];
  console.log(`[hn] Got ${items.length} items from list`);

  // Load existing data for incremental detail fetch
  const existing = await loadExisting();

  // Fetch /item/{id} detail for each item, reuse cached detail
  let fetchedCount = 0;
  for (const item of items) {
    const cached = existing.get(item.id);
    if (cached?.detail) {
      item.detail = cached.detail;
    } else {
      const detail = await fetchDetail(item.id);
      if (detail) {
        item.detail = detail;
        fetchedCount++;
      }
    }
  }
  console.log(`[hn] Fetched ${fetchedCount} new details (${items.length - fetchedCount} cached)`);

  // Carry over cached articleSummary
  for (const item of items) {
    const cached = existing.get(item.id);
    if (cached?.articleSummary && !item.articleSummary) {
      item.articleSummary = cached.articleSummary;
    }
  }

  // Fetch article content + AI summarize
  const ARTICLE_CONCURRENCY = 5;
  const needSummary = items.filter(item => item.url && !item.articleSummary);
  console.log(`[hn] ${needSummary.length} items need article summary`);

  for (let i = 0; i < needSummary.length; i += ARTICLE_CONCURRENCY) {
    const batch = needSummary.slice(i, i + ARTICLE_CONCURRENCY);
    await Promise.all(batch.map(async (item) => {
      const content = await fetchWithPlaywright(item.url!);
      if (!content || content.length < 200) return;
      const summary = await summarizeArticle(item.title, content);
      if (summary) item.articleSummary = summary;
    }));
    console.log(`[hn] Article summary: ${Math.min(i + ARTICLE_CONCURRENCY, needSummary.length)}/${needSummary.length}`);
  }

  // Write output
  await mkdir(DATA_DIR, { recursive: true });
  const output: StoredData = {
    updatedAt: new Date().toISOString(),
    items,
  };
  await writeFile(HN_FILE, JSON.stringify(output, null, 2));
  console.log(`[hn] Written ${HN_FILE}`);

  // Archive what the detail page shows
  await mkdir(ARCHIVE_DIR, { recursive: true });
  for (const item of items) {
    const detail = item.detail as { aiSummary?: NhListItem['aiSummary']; aisummary?: NhListItem['aiSummary'] } | undefined;
    const archived = {
      id: item.id,
      by: item.by,
      title: item.title,
      url: item.url,
      score: item.score,
      createdAt: item.createdAt,
      aiSummary: detail?.aiSummary || detail?.aisummary || item.aiSummary || item.aisummary,
      articleSummary: item.articleSummary,
    };
    await writeFile(path.join(ARCHIVE_DIR, `${item.id}.json`), JSON.stringify(archived, null, 2));
  }
  console.log(`[hn] Archived ${items.length} items`);
  console.log('[hn] Done!');
  } finally {
    await closeBrowser();
  }
}

main().catch(err => {
  console.error(`[hn] Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
