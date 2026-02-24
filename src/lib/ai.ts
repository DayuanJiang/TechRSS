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

  return `你是一个技术内容策展人，正在为一份面向 AI 和软件工程从业者的每日精选摘要筛选文章。文章来源主要是独立技术博客，话题以 AI/LLM、安全和系统工程为主。你的目标是帮读者筛出真正值得阅读的内容，评分区分度至关重要。

请对以下文章进行三个维度的评分（1-10 整数），并分配分类标签和提取关键词。

## 评分纪律

- 大胆使用极端分数：水文/简讯给 1-3，深度技术内容给 8-10
- 先浏览全部文章，再逐篇评分，确保批次内分数有区分度
- 不要因为话题热门（如 AI）就自动给高分，要看文章本身的质量

## 评分维度

### 1. 深度 (depth) - 技术研究深度和证据质量

高分信号：
- AI 类：有 eval 数据（MMLU、HumanEval、SWE-bench 等）、训练细节（compute、数据配比）、推理性能指标（tokens/s、延迟、成本对比）、ablation 实验、生产环境部署经验
- 工程类：有 benchmark、profiling 数据、代码实现细节、架构图、故障复盘、迁移经验
- 安全类：有 PoC、漏洞分析、攻击链细节、影响范围评估

低分信号：
- "Introducing..."、"We're excited to announce..." 等公关文风
- 泛泛而谈 "AI 将改变一切"、"N 个 ChatGPT 技巧" 之类
- 纯新闻转述、周报汇总、无一手信息

评分：8-10 有一手数据/代码/实验 | 5-7 有具体技术细节但无一手数据 | 3-4 准确但泛泛 | 1-2 纯公告/转述

### 2. 新颖性 (novelty) - 信息或观点的独特程度

高分信号：
- 新模型/架构首次发布或首个深度评测
- 挑战主流叙事的观点（如质疑 scaling laws、反思 agent 范式）且有论据支撑
- 首次披露的安全漏洞或未被广泛报道的技术方案
- 从业者一手经验分享（"我在生产环境中用 X 模型做 Y，发现了 Z"）

低分信号：
- 又一篇 RAG 教程 / 又一个 ChatGPT wrapper
- 热点事件的第 N 篇跟风报道
- 重复已有认知且无增量信息

评分：8-10 首次披露/原创研究/独特视角 | 5-7 有新角度但话题非全新 | 3-4 又一篇同质内容 | 1-2 纯转述

### 3. 广度 (breadth) - 对技术从业者群体的覆盖面

高分信号：
- 主流模型的重大更新（GPT/Claude/Gemini 新版本、重大能力变化）
- 影响多语言/多框架的安全漏洞或范式转变
- AI 对软件工程实践的结构性影响（如 agentic coding 改变开发流程）

低分信号：
- 仅适用于某个特定模型的 fine-tuning 技巧
- 某个小众框架的使用心得
- 纯个人经历、周记、月度总结

评分：8-10 全行业关注 | 5-7 跨多个领域有参考价值 | 3-4 仅特定领域 | 1-2 极小众

## 分类标签（选最主要的一个）
- ai-ml: AI、机器学习、LLM、深度学习、prompt engineering、AI 应用
- security: 安全、隐私、漏洞、加密
- engineering: 软件工程、架构、编程语言、系统设计
- tools: 开发工具、开源项目、新发布的库/框架
- opinion: 行业观点、个人思考、职业发展、文化评论
- other: 以上都不太适合的
当文章跨多个分类时，选内容篇幅最大的那个主题。

## 校准示例

| 文章类型 | depth | novelty | breadth | 理由 |
|---------|-------|---------|---------|------|
| 新模型首发评测（含 eval 对比和推理成本）| 9 | 9 | 9 | 有一手 benchmark + 首次评测 + 全行业关注 |
| "我用 Claude Code 重写了整个项目"实战复盘 | 8 | 7 | 8 | 一手经验 + 具体数据，对所有开发者有参考 |
| 又一篇 "如何搭建 RAG pipeline" 教程 | 4 | 2 | 4 | 技术准确但无新意，教程类文章泛滥 |
| "AI 将取代程序员" 的泛泛观点文 | 2 | 2 | 6 | 无数据无论据，但话题本身广度大 |
| 挑战 scaling laws 的深度分析（含实验数据）| 8 | 9 | 8 | 逆主流 + 有实验支撑 + 影响 AI 方向认知 |
| 某 LLM 的 fine-tuning 参数调优经验 | 7 | 5 | 3 | 有技术深度但极其小众 |
| 重大 CVE 首次披露（含 PoC）| 8 | 10 | 10 | 首次披露 + 所有人都需关注 |
| 个人周记/月度回顾 | 2 | 2 | 2 | 无深度、无新意、受众极窄 |
| 带生产数据的架构迁移复盘 | 9 | 8 | 7 | 一手经验 + 罕见真实案例 |
| "XX 发布 v2.0" 新闻简讯 | 2 | 5 | 6 | 无分析纯公告，但版本本身有新意 |

## 关键词
提取 2-4 个英文关键词，专有名词保持原样，其余小写。如 "Claude", "RAG", "inference", "performance"。

## 待评分文章

${articlesList}

严格按以下 JSON 格式返回，不要包含 markdown 代码块或其他文字：
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

function buildSummaryPrompt(articles: Array<{ index: number; title: string; description: string; sourceName: string; link: string; avgScore?: number }>): string {
  const articlesList = articles.map(a => {
    const avg = a.avgScore ?? 0;
    const wordHint = avg >= 6 ? '（摘要约 300 字）' : '（摘要约 100 字）';
    return `Index ${a.index}: [${a.sourceName}] ${a.title} ${wordHint}\nURL: ${a.link}\n${a.description.slice(0, 800)}`;
  }).join('\n\n---\n\n');

  return `你是一个面向 AI 和软件工程从业者的技术内容摘要专家。请为以下文章生成中文标题和摘要。

## 中文标题 (titleZh)

用一句简短的中文概括文章讲了什么。不是翻译原标题，而是提炼核心信息。如果原标题已经是中文且足够好则保持不变。

要求：
- 控制在 20-25 个字以内，宁短勿长
- 突出最关键的一个信息点，不要试图涵盖所有内容
- 技术名词保留英文（如 Rust、RAG、Claude）

示例：
- "Writing about agentic patterns" → "编码代理的六种工程模式"
- "Ladybird adopts Rust, with help from AI" → "Ladybird 借助 AI 从 Swift 迁移到 Rust"
- "Everyone in AI is building the wrong thing" → "AI 创业者的集体方向迷失"

## 摘要 (summary)

让读者不点原文就能获取核心信息。用中文撰写。每篇文章标题后标注了目标字数，请严格遵守字数要求。

写法规则：
- 第一句直接给出核心事实或结论，不要铺垫
- 中间句展开关键论据、技术细节或数据
- 最后一句给出意义、影响或作者的核心判断
- AI 相关文章：提及具体模型名、eval 指标、性能数据、应用场景
- 工程类文章：提及具体技术栈、方案对比、迁移前后变化
- 安全类文章：提及漏洞编号、影响范围、攻击方式

禁止的写法（整篇摘要中都不能出现，不只是开头）：
- ❌ "文章讨论了..."、"文章分析了..."、"文章探讨了..."
- ❌ "本文介绍了..."、"该文指出..."、"作者认为..."
- ✅ 直接陈述事实："Ladybird 浏览器放弃 Swift 转向 Rust，首个迁移目标是 LibJS 引擎。"
- ✅ 直接给结论："代码生成成本趋近于零，传统的设计评审和工时估算流程需要根本性调整。"

保留具体信息：数字、版本号、模型名、百分比、基准测试名称。不要用 "显著提升" 替代 "提升 40%"，不要用 "某大模型" 替代 "Claude 3.5 Sonnet"。

## 待摘要文章

${articlesList}

严格按以下 JSON 格式返回，不要包含 markdown 代码块或其他文字：
{
  "results": [
    {
      "index": 0,
      "titleZh": "中文标题",
      "summary": "摘要内容..."
    }
  ]
}`;
}

export async function summarizeArticles(articles: Array<Article & { index: number; avgScore?: number }>): Promise<Map<number, {
  titleZh: string; summary: string;
}>> {
  const summaries = new Map<number, { titleZh: string; summary: string }>();

  // Skip articles with avgScore < 3
  const toSummarize = articles.filter(a => (a.avgScore ?? 0) >= 3);
  const skipped = articles.length - toSummarize.length;
  if (skipped > 0) console.log(`[ai] Skipping ${skipped} low-score articles (avgScore < 3)`);

  const indexed = toSummarize.map(a => ({ index: a.index, title: a.title, description: a.description, sourceName: a.sourceName, link: a.link, avgScore: a.avgScore }));

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
            summaries.set(r.index, { titleZh: r.titleZh || '', summary: r.summary || '' });
          }
        }
      } catch (error) {
        console.warn(`[ai] Summary batch failed: ${error instanceof Error ? error.message : error}`);
        for (const item of batch) {
          summaries.set(item.index, { titleZh: item.title, summary: item.title });
        }
      }
    }));
    console.log(`[ai] Summary: ${Math.min(i + MAX_CONCURRENT, batches.length)}/${batches.length} batches`);
  }

  return summaries;
}

