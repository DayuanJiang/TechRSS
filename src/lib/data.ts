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
    .filter((f: string) => f.endsWith('.json') && /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
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

/** HN data types */
export interface HnStoredItem {
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
  aisummary?: HnStoredItem['aiSummary'];
  classifications?: { tags?: string[] };
  detail?: {
    aiSummary?: HnStoredItem['aiSummary'];
    aisummary?: HnStoredItem['aiSummary'];
    [key: string]: unknown;
  };
}

export interface HnData {
  updatedAt: string;
  items: HnStoredItem[];
}

/** Load HN data */
export function loadHnData(): HnData | null {
  const file = path.join(DATA_DIR, 'hn.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
