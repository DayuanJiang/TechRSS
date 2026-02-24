import fs from 'node:fs';
import path from 'node:path';
import type { ArticleRow } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');

export interface DigestData {
  date: string;
  total_feeds: number;
  success_feeds: number;
  total_articles: number;
  filtered_articles: number;
  articles: ArticleRow[];
}

/** List all available digest dates, newest first */
export function listDigestDates(): string[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter((f: string) => f.endsWith('.json'))
    .map((f: string) => f.replace('.json', ''))
    .sort()
    .reverse();
}

/** Load a single digest by date */
export function loadDigest(date: string): DigestData | null {
  const file = path.join(DATA_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
