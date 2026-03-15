import type { Browser } from 'playwright';
import TurndownService from 'turndown';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    if (!launching) {
      launching = (async () => {
        const { chromium } = await import('playwright');
        browser = await chromium.launch();
        return browser;
      })();
    }
    browser = await launching;
  }
  return browser;
}

export async function fetchWithPlaywright(url: string): Promise<string | null> {
  try {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
      await page.goto(url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
      const html = await page.content();
      // Try Readability first to extract article body
      try {
        const { document } = parseHTML(html);
        const reader = new Readability(document, { charThreshold: 100 });
        const article = reader.parse();
        if (article?.content) {
          const md = turndown.turndown(article.content);
          if (md && md.length > 100) return md;
        }
      } catch { /* fall through to raw turndown */ }
      return turndown.turndown(html);
    } finally {
      await page.close();
    }
  } catch (e) {
    console.warn(`[fetch-content] Failed ${url}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    launching = null;
  }
}
