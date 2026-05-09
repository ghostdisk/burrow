---
name: browser
description: Browse the web via Playwright. Open pages, extract text/HTML, run JS in page context and search the web. Use when the user asks you search the web, read a webpage, or when you yourself can't figure out something and need to search the web.
---

# Browser Automation

Search engines, read pages, and extract data from the web using Playwright (Chromium).

## Setup

Load the browser module:
```js
eval b = await burrowImport('./path/to/skill/scripts/browser.js');
```

## API

| Function | Returns | Description |
|----------|---------|-------------|
| `b.search(query)` | `Promise<{title, snippet, url, source}[]>` | Search 4 engines (DuckDuckGo, Bing, Yahoo), deduped by URL |
| `b.openTab(url?)` | `Promise<{id, page, ctx, url}>` | Open a new browser tab. URL should include `https://` prefix |
| `b.closeTab(tab)` | `Promise<void>` | Close tab (cleans Playwright context) |
| `b.pageText(page)` | `Promise<string>` | Get `document.body.innerText` |
| `b.pageHTML(page)` | `Promise<string>` | Get full page HTML |
| `b.extract(page, fn)` | `Promise<any>` | Run `fn()` in browser page context |
| `b.launch()` | `Promise<void>` | Start Chromium (auto-called on first use) |
| `b.tabs` | `array` | Currently open tabs |

## Typical Flow (sequential — recommended)

```js
const b = await import('./skills/browser/scripts/browser.js');
const results = await b.search("my query");
const tab = await b.openTab("https://" + results[0].url);
const text = await b.pageText(tab.page);       // ← await it! .slice() etc. now works
const snippet = text.slice(0, 500);
```

## Pitfalls

- ❌ `b.pageText(tab.page).slice(0, N)` — ERROR: pageText is async → returns Promise!
- ✅ `(await b.pageText(tab.page)).slice(0, N)`
- ❌ Sharing a single page across parallel `openTab` + `pageText` in `Promise.all` — use sequential calls instead.

## Search Result URLs

`search()` returns raw URLs (usually without protocol). Prepend `https://` when using `openTab`:
```js
b.openTab("https://" + result.url);
```
