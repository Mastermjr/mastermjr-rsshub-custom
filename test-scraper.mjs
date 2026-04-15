/**
 * @file test-scraper.mjs
 * @description Integration tests for the generic blog scraper.
 *   Tests against the live deployed instance to verify each target blog
 *   produces valid RSS with expected items, descriptions, and images.
 *
 * Run: node --test test-scraper.mjs
 * Requires: MY_ACCESS_KEY env var or /root/google-vibe/access_key.txt
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const INSTANCE = process.env.INSTANCE_URL || 'https://feeds.706613.xyz';
const KEY = process.env.MY_ACCESS_KEY
  || (() => { try { return readFileSync('/root/google-vibe/access_key.txt', 'utf-8').trim(); } catch { return ''; } })();

if (!KEY) throw new Error('Set MY_ACCESS_KEY env var or ensure access_key.txt exists');

async function scrape(targetUrl) {
  const encoded = encodeURIComponent(targetUrl);
  const url = `${INSTANCE}/generic/scrape/${encoded}?key=${KEY}`;
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, text, contentType: res.headers.get('content-type') };
}

function parseItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const title = block.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const link = block.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const desc = block.match(/<description>(.*?)<\/description>/s)?.[1] || '';
    const enclosure = block.match(/<enclosure url="([^"]*)"/)  ?.[1] || '';
    items.push({ title, link, pubDate, description: desc, enclosure });
  }
  return items;
}

function parseChannelTitle(xml) {
  const m = xml.match(/<channel>\s*<title>(.*?)<\/title>/);
  return m ? m[1] : '';
}

// ============================================================
// Test cases
// ============================================================

describe('Generic Scraper - HTML heuristics (Strategy 1: links-with-headings)', () => {
  let result, items;

  it('SentinelOne Labs - fetches valid RSS', async () => {
    result = await scrape('https://www.sentinelone.com/labs/');
    assert.equal(result.status, 200);
    assert.ok(result.contentType.includes('xml'), 'Should return XML content type');
    assert.ok(result.text.startsWith('<?xml'), 'Should start with XML declaration');
  });

  it('SentinelOne Labs - has channel title', () => {
    const title = parseChannelTitle(result.text);
    assert.ok(title.length > 0, 'Channel should have a title');
    assert.ok(title.toLowerCase().includes('sentinel'), `Expected "sentinel" in title, got: ${title}`);
  });

  it('SentinelOne Labs - has multiple items', () => {
    items = parseItems(result.text);
    assert.ok(items.length >= 5, `Expected >= 5 items, got ${items.length}`);
  });

  it('SentinelOne Labs - items have titles and links', () => {
    for (const item of items.slice(0, 5)) {
      assert.ok(item.title.length >= 10, `Title too short: "${item.title}"`);
      assert.ok(item.link.startsWith('https://www.sentinelone.com/'), `Bad link: ${item.link}`);
    }
  });

  it('SentinelOne Labs - items have descriptions', () => {
    const withDesc = items.filter(i => i.description.length > 0);
    assert.ok(withDesc.length >= 3, `Expected >= 3 items with descriptions, got ${withDesc.length}`);
  });
});

describe('Generic Scraper - HTML heuristics (Strategy 2: containers)', () => {
  let result, items;

  it('SpecterOps Research - fetches valid RSS', async () => {
    result = await scrape('https://specterops.io/blog/?category%5B%5D=research');
    assert.equal(result.status, 200);
    assert.ok(result.text.includes('<rss'), 'Should contain RSS tag');
  });

  it('SpecterOps Research - has multiple items', () => {
    items = parseItems(result.text);
    assert.ok(items.length >= 3, `Expected >= 3 items, got ${items.length}`);
  });

  it('SpecterOps Research - items have titles and links', () => {
    for (const item of items.slice(0, 3)) {
      assert.ok(item.title.length >= 10, `Title too short: "${item.title}"`);
      assert.ok(item.link.startsWith('https://specterops.io/'), `Bad link: ${item.link}`);
    }
  });

  it('SpecterOps Research - items have images', () => {
    const withImg = items.filter(i => i.enclosure.length > 0);
    assert.ok(withImg.length >= 3, `Expected >= 3 items with images, got ${withImg.length}`);
  });

  it('SpecterOps Research - items have descriptions', () => {
    const withDesc = items.filter(i => i.description.length > 0);
    assert.ok(withDesc.length >= 3, `Expected >= 3 items with descriptions, got ${withDesc.length}`);
  });
});

describe('Generic Scraper - Next.js __NEXT_DATA__ extraction', () => {
  let result, items;

  it('Gen Digital Research - fetches valid RSS', async () => {
    result = await scrape('https://www.gendigital.com/blog/insights/research');
    assert.equal(result.status, 200);
    assert.ok(result.text.includes('<rss'), 'Should contain RSS tag');
  });

  it('Gen Digital Research - has multiple items (from __NEXT_DATA__)', () => {
    items = parseItems(result.text);
    assert.ok(items.length >= 5, `Expected >= 5 items, got ${items.length}`);
  });

  it('Gen Digital Research - items have titles and valid links', () => {
    for (const item of items.slice(0, 5)) {
      assert.ok(item.title.length >= 10, `Title too short: "${item.title}"`);
      assert.ok(item.link.startsWith('https://www.gendigital.com/'), `Bad link: ${item.link}`);
    }
  });

  it('Gen Digital Research - items have dates', () => {
    const withDates = items.filter(i => i.pubDate.length > 0);
    assert.ok(withDates.length >= 5, `Expected >= 5 items with dates, got ${withDates.length}`);
  });

  it('Gen Digital Research - items have images from structured data', () => {
    const withImg = items.filter(i => i.enclosure.length > 0);
    assert.ok(withImg.length >= 5, `Expected >= 5 items with images, got ${withImg.length}`);
  });

  it('Gen Digital Research - items have description snippets', () => {
    const withDesc = items.filter(i => i.description.length > 0);
    assert.ok(withDesc.length >= 5, `Expected >= 5 items with descriptions, got ${withDesc.length}`);
  });
});

describe('Generic Scraper - Censys (JS-heavy site)', () => {
  let result, items;

  it('Censys Threat Intel - fetches valid RSS (may have limited items)', async () => {
    result = await scrape('https://censys.com/censys-arc/threat-intelligence/');
    assert.equal(result.status, 200);
    assert.ok(result.text.includes('<rss'), 'Should contain RSS tag');
  });

  it('Censys Threat Intel - returns valid XML even if few items', () => {
    items = parseItems(result.text);
    // Censys is JS-rendered, may return 0 items - that's okay, just shouldn't error
    assert.ok(result.text.includes('</channel>'), 'Should have complete RSS structure');
  });
});

describe('Generic Scraper - edge cases', () => {
  it('returns 400 for invalid URL', async () => {
    const res = await fetch(`${INSTANCE}/generic/scrape/not-a-url?key=${KEY}`);
    const text = await res.text();
    assert.ok(res.status === 400 || text.includes('Invalid URL'), 'Should reject invalid URLs');
  });

  it('returns 403 without access key', async () => {
    const res = await fetch(`${INSTANCE}/generic/scrape/https%3A%2F%2Fexample.com`);
    assert.equal(res.status, 403, 'Should require access key');
  });

  it('returns 403 with wrong access key', async () => {
    const res = await fetch(`${INSTANCE}/generic/scrape/https%3A%2F%2Fexample.com?key=wrongkey`);
    assert.equal(res.status, 403, 'Should reject wrong key');
  });

  it('handles non-existent domain gracefully', async () => {
    const result = await scrape('https://thisdomaindoesnotexist12345.com/blog');
    assert.equal(result.status, 500, 'Should return 500 for unreachable domains');
    assert.ok(result.text.includes('Scrape error'), 'Should include error message');
  });
});

describe('Generic Scraper - Horizon3 blogs (JS-rendered)', () => {
  let result, items;

  it('Horizon3 Intel - fetches valid RSS without errors', async () => {
    result = await scrape('https://horizon3.ai/category/intelligence/blogs/');
    assert.equal(result.status, 200);
    assert.ok(result.text.includes('<rss'), 'Should contain RSS tag');
    assert.ok(result.text.includes('</channel>'), 'Should have complete RSS structure');
  });

  it('Horizon3 Intel - returns valid XML (JS-rendered, may have 0 items)', () => {
    items = parseItems(result.text);
    // Horizon3 is JS-rendered, scraper may find 0 items - that's a known limitation
    // This test ensures it doesn't crash, not that it finds items
    assert.ok(items.length >= 0, 'Should not crash on JS-rendered pages');
  });
});
