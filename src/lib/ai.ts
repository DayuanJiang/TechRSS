import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { generateText } from 'ai';
import type { Article } from './types';

const bedrock = createAmazonBedrock({ region: 'us-east-1' });
const MODEL_ID = 'zai.glm-4.7';
const BATCH_SIZE = 10;
const MAX_CONCURRENT = 2;

interface ScoringResult {
  results: Array<{
    index: number;
    depth: number;
    novelty: number;
    breadth: number;
    category: string;
    keywords: string[];
  }>;
}

interface SummaryResult {
  results: Array<{
    index: number;
    titleZh: string;
    summary: string;
    reason: string;
  }>;
}

async function callLLM(prompt: string): Promise<string> {
  const { text } = await generateText({
    model: bedrock(MODEL_ID),
    prompt,
    maxOutputTokens: 4096,
    temperature: 0.3,
  });
  return text;
}

function parseJsonResponse<T>(text: string): T {
  let jsonText = text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(jsonText) as T;
}

// --- Scoring ---

function buildScoringPrompt(articles: Array<{ index: number; title: string; description: string; sourceName: string }>): string {
  const articlesList = articles.map(a =>
    `Index ${a.index}: [${a.sourceName}] ${a.title}\n${a.description.slice(0, 300)}`
  ).join('\n\n---\n\n');

  return `你是一个技术内容策展人，正在为一份面向技术爱好者的每日精选摘要筛选文章。

请对以下文章进行三个维度的评分（1-10 整数，10 分最高），并为每篇文章分配一个分类标签和提取 2-4 个关键词。

## 评分维度

### 1. 深度 (depth) - 文章的研究深度和证据质量
- 10: 有代码、数据、基准测试、一手经验的深度分析
- 7-9: 有具体技术细节和实践经验
- 4-6: 信息准确但缺少深入分析
- 1-3: 纯转述新闻稿或无实质内容

### 2. 新颖性 (novelty) - 信息或观点的独特程度
- 10: 首次披露、独特视角、挑战主流认知
- 7-9: 有新的洞见或不常见的角度
- 4-6: 有一定新意但话题已有较多报道
- 1-3: 同一话题的第 N 篇重复报道

### 3. 广度 (breadth) - 对技术从业者群体的覆盖面
- 10: 所有技术人都应知道的重大事件（重大 CVE、范式转变等）
- 7-9: 对大部分技术从业者有价值
- 4-6: 对特定技术领域有价值
- 1-3: 极小众领域，受众极少

## 分类标签（必须从以下选一个）
- ai-ml: AI、机器学习、LLM、深度学习相关
- security: 安全、隐私、漏洞、加密相关
- engineering: 软件工程、架构、编程语言、系统设计
- tools: 开发工具、开源项目、新发布的库/框架
- opinion: 行业观点、个人思考、职业发展、文化评论
- other: 以上都不太适合的

## 关键词提取
提取 2-4 个最能代表文章主题的关键词（用英文，简短，如 "Rust", "LLM", "database", "performance"）

## 待评分文章

${articlesList}

请严格按 JSON 格式返回，不要包含 markdown 代码块或其他文字：
{
  "results": [
    {
      "index": 0,
      "depth": 8,
      "novelty": 7,
      "breadth": 9,
      "category": "engineering",
      "keywords": ["Rust", "compiler", "performance"]
    }
  ]
}`;
}

export async function scoreArticles(articles: Article[]): Promise<Map<number, {
  depth: number; novelty: number; breadth: number;
  category: string; keywords: string[];
}>> {
  const allScores = new Map<number, {
    depth: number; novelty: number; breadth: number;
    category: string; keywords: string[];
  }>();
  const indexed = articles.map((a, i) => ({ index: i, title: a.title, description: a.description, sourceName: a.sourceName }));

  const batches: typeof indexed[] = [];
  for (let i = 0; i < indexed.length; i += BATCH_SIZE) {
    batches.push(indexed.slice(i, i + BATCH_SIZE));
  }

  console.log(`[ai] Scoring ${articles.length} articles in ${batches.length} batches`);
  const validCategories = new Set(['ai-ml', 'security', 'engineering', 'tools', 'opinion', 'other']);

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const group = batches.slice(i, i + MAX_CONCURRENT);
    await Promise.all(group.map(async (batch) => {
      try {
        const text = await callLLM(buildScoringPrompt(batch));
        const parsed = parseJsonResponse<ScoringResult>(text);
        if (parsed.results) {
          for (const r of parsed.results) {
            const clamp = (v: number) => Math.min(10, Math.max(1, Math.round(v)));
            allScores.set(r.index, {
              depth: clamp(r.depth),
              novelty: clamp(r.novelty),
              breadth: clamp(r.breadth),
              category: validCategories.has(r.category) ? r.category : 'other',
              keywords: Array.isArray(r.keywords) ? r.keywords.slice(0, 4) : [],
            });
          }
        }
      } catch (error) {
        console.warn(`[ai] Scoring batch failed: ${error instanceof Error ? error.message : error}`);
        for (const item of batch) {
          allScores.set(item.index, { depth: 5, novelty: 5, breadth: 5, category: 'other', keywords: [] });
        }
      }
    }));
    console.log(`[ai] Scoring: ${Math.min(i + MAX_CONCURRENT, batches.length)}/${batches.length} batches`);
  }

  return allScores;
}

// --- Summarization ---

function buildSummaryPrompt(articles: Array<{ index: number; title: string; description: string; sourceName: string; link: string }>): string {
  const articlesList = articles.map(a =>
    `Index ${a.index}: [${a.sourceName}] ${a.title}\nURL: ${a.link}\n${a.description.slice(0, 800)}`
  ).join('\n\n---\n\n');

  return `你是一个技术内容摘要专家。请为以下文章完成三件事：

1. **中文标题** (titleZh): 用一句中文概括文章的核心内容（不是翻译原标题，而是一句话总结讲了什么）。如果原标题已经是中文则保持不变。例如：原标题 "Writing about agentic patterns" → "AI 智能体工程中的六种核心设计模式及其适用场景"
2. **摘要** (summary): 4-6 句话的结构化摘要，让读者不点进原文也能了解核心内容。包含：
   - 文章讨论的核心问题或主题（1 句）
   - 关键论点、技术方案或发现（2-3 句）
   - 结论或作者的核心观点（1 句）
3. **推荐理由** (reason): 1 句话说明"为什么值得读"，区别于摘要（摘要说"是什么"，推荐理由说"为什么"）。

请用中文撰写摘要和推荐理由。如果原文是英文，请翻译为中文。

摘要要求：
- 禁止使用以下句式开头：'作者...'、'文章指出...'、'文章介绍了...'、'本文...'、'该文...'。直接陈述事实和结论。
- 直接说重点，不要用"本文讨论了..."、"这篇文章介绍了..."这种开头
- 包含具体的技术名词、数据、方案名称或观点
- 保留关键数字和指标（如性能提升百分比、用户数、版本号等）
- 如果文章涉及对比或选型，要点出比较对象和结论
- 目标：读者花 30 秒读完摘要，就能决定是否值得花 10 分钟读原文

## 待摘要文章

${articlesList}

请严格按 JSON 格式返回：
{
  "results": [
    {
      "index": 0,
      "titleZh": "中文翻译的标题",
      "summary": "摘要内容...",
      "reason": "推荐理由..."
    }
  ]
}`;
}

export async function summarizeArticles(articles: Array<Article & { index: number }>): Promise<Map<number, {
  titleZh: string; summary: string; reason: string;
}>> {
  const summaries = new Map<number, { titleZh: string; summary: string; reason: string }>();
  const indexed = articles.map(a => ({ index: a.index, title: a.title, description: a.description, sourceName: a.sourceName, link: a.link }));

  const batches: typeof indexed[] = [];
  for (let i = 0; i < indexed.length; i += BATCH_SIZE) {
    batches.push(indexed.slice(i, i + BATCH_SIZE));
  }

  console.log(`[ai] Summarizing ${articles.length} articles in ${batches.length} batches`);

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const group = batches.slice(i, i + MAX_CONCURRENT);
    await Promise.all(group.map(async (batch) => {
      try {
        const text = await callLLM(buildSummaryPrompt(batch));
        const parsed = parseJsonResponse<SummaryResult>(text);
        if (parsed.results) {
          for (const r of parsed.results) {
            summaries.set(r.index, { titleZh: r.titleZh || '', summary: r.summary || '', reason: r.reason || '' });
          }
        }
      } catch (error) {
        console.warn(`[ai] Summary batch failed: ${error instanceof Error ? error.message : error}`);
        for (const item of batch) {
          summaries.set(item.index, { titleZh: item.title, summary: item.title, reason: '' });
        }
      }
    }));
    console.log(`[ai] Summary: ${Math.min(i + MAX_CONCURRENT, batches.length)}/${batches.length} batches`);
  }

  return summaries;
}

// --- Highlights ---

export async function generateHighlights(articles: Array<{ category: string; titleZh: string; title: string; summary: string }>): Promise<string> {
  const articleList = articles.slice(0, 10).map((a, i) =>
    `${i + 1}. [${a.category}] ${a.titleZh || a.title} — ${a.summary.slice(0, 100)}`
  ).join('\n');

  const prompt = `根据以下今日精选技术文章列表，写一段 3-5 句话的"今日看点"总结。
要求：
- 提炼出今天技术圈的 2-3 个主要趋势或话题
- 不要逐篇列举，要做宏观归纳
- 风格简洁有力，像新闻导语
用中文回答。

文章列表：
${articleList}

直接返回纯文本总结，不要 JSON，不要 markdown 格式。`;

  try {
    const text = await callLLM(prompt);
    return text.trim();
  } catch (error) {
    console.warn(`[ai] Highlights failed: ${error instanceof Error ? error.message : error}`);
    return '';
  }
}
