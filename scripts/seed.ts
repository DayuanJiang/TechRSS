import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fetchFeed } from '../src/lib/rss';
import { CATEGORY_META } from '../src/lib/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const feed = { name: 'simonwillison.net', xmlUrl: 'https://simonwillison.net/atom/everything/', htmlUrl: 'https://simonwillison.net' };

async function main() {
  console.log('Fetching RSS...');
  const articles = await fetchFeed(feed);
  console.log(`Got ${articles.length} articles`);

  const categories = ['ai-ml', 'engineering', 'tools', 'opinion', 'other'] as const;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });

  const data = {
    date: today,
    total_feeds: 90,
    success_feeds: 85,
    total_articles: 342,
    filtered_articles: 127,
    articles: articles.slice(0, 15).map((a, i) => ({
      title: a.title,
      title_zh: `[模拟] ${a.title}`,
      link: a.link,
      pub_date: a.pubDate.toISOString(),
      summary: `这是来自 ${a.sourceName} 的文章摘要。${a.description.slice(0, 150)}`,
      source_name: a.sourceName,
      score: 30 - i,
      category: categories[i % categories.length],
      keywords: ['tech', 'blog'],
      rank: i + 1,
    })),
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, `${today}.json`), JSON.stringify(data, null, 2));
  console.log(`Written data/${today}.json`);
}

main();
