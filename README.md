# TechRSS

AI-curated daily tech digest from 94 independent blogs, scored and summarized in Chinese.

**Live site**: https://dayuanjiang.github.io/TechRSS/

## How it works

1. **Fetch** - Pulls RSS feeds from 94 independent tech blogs (Simon Willison, Paul Graham, Troy Hunt, Krebs on Security, etc.)
2. **Score** - Each article is scored by AI (GLM-4.7 via Amazon Bedrock) on three dimensions: depth, novelty, and breadth (1-10)
3. **Summarize** - Top articles get a Chinese title and 3-5 sentence Chinese summary
4. **Publish** - Static site rebuilt and deployed to GitHub Pages

Runs incrementally every 30 minutes via GitHub Actions. Only new articles trigger AI calls.

## Tech stack

- [Astro](https://astro.build/) + Tailwind CSS
- [Vercel AI SDK](https://sdk.vercel.ai/) + Amazon Bedrock
- TypeScript

## Development

```bash
npm install
npm run dev        # Dev server
npm run digest     # Run the digest pipeline (requires AWS credentials)
npm run build      # Build static site
```
