export type CategoryId = 'ai-ml' | 'security' | 'engineering' | 'tools' | 'opinion' | 'other';

export const CATEGORY_META: Record<CategoryId, { emoji: string; label: string }> = {
  'ai-ml': { emoji: '🤖', label: 'AI / ML' },
  'security': { emoji: '🔒', label: '安全' },
  'engineering': { emoji: '⚙️', label: '工程' },
  'tools': { emoji: '🛠', label: '工具 / 开源' },
  'opinion': { emoji: '💡', label: '观点 / 杂谈' },
  'other': { emoji: '📝', label: '其他' },
};

export interface Article {
  title: string;
  link: string;
  pubDate: Date;
  content: string;
  sourceName: string;
  sourceUrl: string;
}

export interface ArticleRow {
  title: string;
  title_zh: string;
  link: string;
  pub_date: string;
  summary: string;
  source_name: string;
  score: number;
  depth: number;
  novelty: number;
  category: string;
  keywords: string[];
  rank: number;
}
