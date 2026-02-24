import { fetchFeed } from '../src/lib/rss';
import { writeFile } from 'node:fs/promises';
import { CATEGORY_META } from '../src/lib/types';

const feed = { name: 'simonwillison.net', xmlUrl: 'https://simonwillison.net/atom/everything/', htmlUrl: 'https://simonwillison.net' };

async function main() {
  console.log('Fetching RSS from simonwillison.net...');
  const articles = await fetchFeed(feed);
  console.log(`Got ${articles.length} articles`);

  const categories = ['ai-ml', 'engineering', 'tools', 'opinion', 'other'] as const;
  const today = new Date().toISOString().slice(0, 10);

  // Generate mock scored articles
  const mockArticles = articles.slice(0, 15).map((a, i) => {
    const cat = categories[i % categories.length];
    const score = 30 - i;
    const domain = (() => {
      try { return new URL(a.link).hostname.replace('www.', ''); }
      catch { return a.sourceName; }
    })();
    const diffMs = Date.now() - a.pubDate.getTime();
    const diffH = Math.floor(diffMs / 3_600_000);
    const diffD = Math.floor(diffMs / 86_400_000);
    const timeAgo = diffH < 24 ? `${diffH}h` : `${diffD}d`;
    const catMeta = CATEGORY_META[cat];

    return {
      rank: i + 1,
      title: a.title,
      title_zh: `[模拟中文] ${a.title}`,
      link: a.link,
      pub_date: a.pubDate.toISOString(),
      summary: `这是一篇来自 ${a.sourceName} 的文章。${a.description.slice(0, 200)}`,
      reason: '深度技术分析，值得一读。',
      source_name: a.sourceName,
      score,
      category: cat,
      keywords: ['tech', 'blog'],
      domain,
      timeAgo,
      catEmoji: catMeta.emoji,
      catLabel: catMeta.label,
    };
  });

  // Build HTML
  const articleRows = mockArticles.map(a => `
    <li class="article-item">
      <div>
        <span class="article-rank">${a.rank}.</span>
        <span class="article-title">
          <a href="${a.link}" target="_blank" rel="noopener">${a.title_zh}</a>
        </span>
        <span style="font-size:0.8em;color:#828282">(${a.domain})</span>
      </div>
      <div class="article-meta">
        <span class="article-score">${a.score}/30</span>
        &middot;
        <span class="category-tag">${a.catEmoji} ${a.catLabel}</span>
        &middot; ${a.timeAgo}
        &middot; ${a.source_name}
        &middot;
        <button class="toggle-btn" onclick="this.closest('.article-item').querySelector('.article-details').classList.toggle('open'); this.textContent = this.textContent === '展开' ? '收起' : '展开';">展开</button>
      </div>
      <div class="article-details">
        <div class="summary">${a.summary}</div>
        <div class="reason">${a.reason}</div>
        <div style="margin-top:4px;font-size:0.9em;color:#999">${a.keywords.join(' · ')}</div>
        <div style="margin-top:6px">
          <a href="${a.link}" target="_blank" rel="noopener" style="color:#ff6600;font-size:0.9em">阅读原文 &rarr;</a>
        </div>
      </div>
    </li>`).join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TechDigest — ${today}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #f6f6ef; color: #333; line-height: 1.6; }
    a { color: #333; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { max-width: 960px; margin: 0 auto; padding: 0 16px; }
    header { background: #ff6600; padding: 8px 0; }
    header .container { display: flex; align-items: center; gap: 12px; }
    header a { color: #fff; }
    header .logo { font-weight: bold; font-size: 1.1em; white-space: nowrap; }
    header .tagline { font-size: 0.85em; opacity: 0.9; color: #fff; }
    main { padding: 16px 0; }
    .highlights { background: #fff; border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px 16px; margin-bottom: 16px; font-size: 0.95em; line-height: 1.7; }
    .highlights-title { font-weight: bold; margin-bottom: 6px; color: #ff6600; }
    .stats { font-size: 0.8em; color: #888; margin-bottom: 16px; }
    .nav { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; font-size: 0.9em; border-top: 1px solid #e0e0e0; margin-top: 16px; }
    .nav a { color: #ff6600; font-weight: 500; }
    .nav .date { color: #666; }
    .article-list { list-style: none; }
    .article-item { padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
    .article-item:last-child { border-bottom: none; }
    .article-rank { display: inline-block; width: 28px; color: #999; font-size: 0.85em; text-align: right; margin-right: 4px; }
    .article-title { font-size: 0.95em; }
    .article-title a { color: #333; }
    .article-title a:visited { color: #828282; }
    .article-meta { font-size: 0.8em; color: #828282; padding-left: 32px; }
    .article-score { color: #ff6600; font-weight: 500; }
    .article-details { display: none; padding: 8px 0 8px 32px; font-size: 0.88em; line-height: 1.7; color: #555; }
    .article-details.open { display: block; }
    .article-details .summary { margin-bottom: 6px; }
    .article-details .reason { color: #ff6600; font-style: italic; }
    .toggle-btn { background: none; border: none; color: #828282; cursor: pointer; font-size: 0.8em; padding: 0; }
    .toggle-btn:hover { text-decoration: underline; }
    .category-tag { display: inline-block; font-size: 0.75em; padding: 1px 6px; border-radius: 3px; background: #f0f0f0; color: #666; }
    footer { text-align: center; padding: 20px 0; font-size: 0.8em; color: #999; border-top: 1px solid #e0e0e0; }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <a class="logo" href="/">TechDigest</a>
      <span class="tagline">90 个顶级技术博客，AI 每日精选</span>
    </div>
  </header>
  <main class="container">
    <nav class="nav">
      <span></span>
      <span class="date">${today}</span>
      <span></span>
    </nav>

    <div class="highlights">
      <div class="highlights-title">今日看点</div>
      今日技术圈关注焦点集中在 AI 工具链的快速演进和开源生态的持续繁荣。多篇文章探讨了 LLM 在实际开发流程中的深度整合，从代码生成到自动化测试的全链路应用正在成为主流趋势。与此同时，安全领域的讨论也在升温，隐私保护和数据治理成为不可忽视的话题。
    </div>

    <div class="stats">
      扫描 85/90 源 · 获取 342 篇 · 精选 ${mockArticles.length} 篇
    </div>

    <ol class="article-list">
      ${articleRows}
    </ol>

    <nav class="nav">
      <span></span>
      <span class="date">${today}</span>
      <span></span>
    </nav>
  </main>
  <footer>
    <div class="container">
      基于 Karpathy 推荐的 HN 热门博客 RSS 源
    </div>
  </footer>
</body>
</html>`;

  await writeFile('preview.html', html);
  console.log('Written preview.html');
}

main();
