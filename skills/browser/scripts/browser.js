/*
  Burrow browser helpers — import with: b = await import('./skills/browser/scripts/browser.js')

  ── API ─────────────────────────────────────────────────────────────────
    search(query): Promise<{title, snippet, url, source}[]>   search 4 engines, deduped
    openTab(url?): Promise<{id, page, ctx, url}>              open tab, returns tab object
    closeTab(tab): Promise<void>                               close tab (cleans Playwright context)
    pageText(page): Promise<string>                            document.body.innerText
    pageHTML(page): Promise<string>                            full page HTML
    extract(page, fn): Promise<any>                            run fn() in page context
    launch(): Promise<void>                                    start Chromium (auto-called)
    tabs                                                       array of currently open tabs

  ── Typical flow (sequential — recommended) ────────────────────────────
    const b = await import('/home/alex/burrow/js/browser.js');
    const results = await b.search("my query");
    const tab = await b.openTab("https://" + results[0].url);
    const text = await b.pageText(tab.page);       // ← await it! .slice() etc. now works
    const snippet = text.slice(0, 500);

  ── Pitfalls ───────────────────────────────────────────────────────────
  ✗ b.pageText(tab.page).slice(0, N)   // ERROR: pageText is async → returns Promise!
  ✓ (await b.pageText(tab.page)).slice(0, N)

  ✗ Trying to share a single page across parallel openTab + pageText
     in Promise.all — prefer sequential unless you know what you're doing.

  ── Search result URLs ─────────────────────────────────────────────────
  search() returns raw URLs (usually without protocol). Prepend "https://"
  when feeding to openTab, or use openTab results from b.search() directly
  via browser.openTab("https://" + result.url).
*/

import { chromium } from 'playwright';

// ── State ──────────────────────────────────────────────
let _browser = null;
let _seq = 0;
export const tabs = [];

// ── Launch ─────────────────────────────────────────────
export async function launch(options = {}) {
  if (_browser) return _browser;
  _browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    ...options,
  });
  return _browser;
}

export function browser() {
  return _browser;
}

// ── Stealth setup ──────────────────────────────────────
const stealthScript = () => {
  // Hide automation signals
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  // Plug Chrome runtime for completeness
  window.chrome ??= { runtime: {} };
};

const stealthUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function stealthContext(options = {}) {
  return await _browser.newContext({
    userAgent: stealthUA,
    viewport: { width: 1280, height: 800 },
    ...options,
  });
}

export async function stealthPage() {
  await launch(); // auto-launch if needed
  const ctx = await stealthContext();
  const page = await ctx.newPage();
  await page.addInitScript(stealthScript);
  return page;
}

// ── Tab management ─────────────────────────────────────
export async function openTab(url) {
  const page = await stealthPage();
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
  const tab = {
    id: ++_seq,
    page,
    ctx: page.context(),
    get url() { return page.url(); },
  };
  tabs.push(tab);
  return tab;
}

export async function closeTab(tab) {
  await tab.ctx.close();
  const i = tabs.indexOf(tab);
  if (i >= 0) tabs.splice(i, 1);
}

// ── Page helpers ───────────────────────────────────────
export async function pageText(page) {
  return await page.evaluate(() => document.body.innerText);
}

export async function pageHTML(page) {
  return await page.content();
}

export async function extract(page, fn) {
  return await page.evaluate(fn);
}

// ── Search ─────────────────────────────────────────────

const ENGINES = [
  {
    name: 'DuckDuckGo HTML',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    extract: () => {
      const items = document.querySelectorAll('.result');
      return [...items].map(r => ({
        title: r.querySelector('.result__title')?.innerText?.trim() || '',
        snippet: r.querySelector('.result__snippet')?.innerText?.trim() || '',
        url: r.querySelector('.result__url')?.innerText?.trim() || '',
      }));
    },
  },
  {
    name: 'Bing',
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    extract: () => {
      const items = document.querySelectorAll('li.b_algo, .b_algo');
      return [...items].map(r => {
        const h2 = r.querySelector('h2 a');
        const p = r.querySelector('.b_caption p, p');
        return {
          title: h2?.innerText?.trim() || '',
          snippet: p?.innerText?.trim()?.slice(0, 300) || '',
          url: h2?.href || '',
        };
      });
    },
  },
  {
    name: 'DuckDuckGo',
    url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    wait: 2000,
    extract: () => {
      const items = document.querySelectorAll('article[data-testid="result"]');
      return [...items].map(r => {
        const a = r.querySelector('a[data-testid="result-title-a"]');
        const s = r.querySelector('[data-result="snippet"]');
        return {
          title: a?.innerText?.trim() || '',
          snippet: s?.innerText?.trim()?.slice(0, 300) || '',
          url: a?.href || '',
        };
      });
    },
  },
  {
    name: 'Yahoo',
    url: (q) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`,
    setup: async (page) => {
      try {
        const btn = await page.$('button[name="reject"]') || await page.$('button[value="reject"]');
        if (btn) { await btn.click(); await page.waitForTimeout(500); }
      } catch (_) {}
    },
    extract: () => {
      const items = document.querySelectorAll('.algo, .dd');
      return [...items].map(r => {
        const a = r.querySelector('h3 a, a');
        const p = r.querySelector('.compText, p');
        return {
          title: a?.innerText?.trim() || '',
          snippet: p?.innerText?.trim()?.slice(0, 300) || '',
          url: a?.href || '',
        };
      });
    },
  },
];

export async function search(query, { engines = ENGINES, timeout = 8000 } = {}) {
  const jobs = engines.map(async (engine) => {
    const page = await stealthPage();
    try {
      await page.goto(engine.url(query), { waitUntil: 'load', timeout });
      if (engine.setup) await engine.setup(page);
      if (engine.wait) await page.waitForTimeout(engine.wait);

      const items = await page.evaluate(engine.extract);
      return items
        .filter(r => r.title && r.url)
        .map(r => ({ ...r, source: engine.name }));
    } catch (_) {
      return [];
    } finally {
      await page.context().close();
    }
  });

  const batches = await Promise.allSettled(jobs);
  const all = [];
  const seen = new Set();
  for (const b of batches) {
    if (b.status === 'fulfilled') {
      for (const r of b.value) {
        const key = r.url.slice(0, 200);
        if (!seen.has(key)) {
          seen.add(key);
          all.push(r);
        }
      }
    }
  }
  return all;
}
