import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const HN_FILE = path.join(DATA_DIR, 'hn.json');
const NH_API = 'https://api.newshacker.me';

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
  classifications?: { tags?: string[] };
}

async function main() {
  console.log('[hn] Fetching top stories from newshacker.me...');
  const r = await fetch(`${NH_API}/list?page=1&pageSize=50&minScore=100`);
  if (!r.ok) {
    console.error(`[hn] API returned ${r.status}`);
    process.exit(1);
  }
  const data = await r.json() as { items: NhListItem[] };
  const items = data.items || [];
  console.log(`[hn] Got ${items.length} items`);

  // Write output
  await mkdir(DATA_DIR, { recursive: true });
  const output = {
    updatedAt: new Date().toISOString(),
    items,
  };
  await writeFile(HN_FILE, JSON.stringify(output, null, 2));
  console.log(`[hn] Written ${HN_FILE}`);
  console.log('[hn] Done!');
}

main().catch(err => {
  console.error(`[hn] Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
