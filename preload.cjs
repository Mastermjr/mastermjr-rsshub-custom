/**
 * @file preload.cjs
 * @description Hooks into RSSHub's HTTP server to serve /generate (linker) and a custom
 *   root page with Generate button. Loaded via NODE_OPTIONS="--require".
 *
 * @decision Intercept / and /generate at the prototype level rather than trying to inject
 *   into Hono's streamed responses. Hono's @hono/node-server uses pipeline() to stream
 *   Response bodies, bypassing res.write()/end() wrappers. Serving our own pages for these
 *   two routes is reliable and simple — all other routes pass through to RSSHub untouched.
 */
const http = require('http');
const fs = require('fs');

const LINKER_HTML = fs.readFileSync('/srv/linker.html', 'utf8');

// Custom root page — matches RSSHub's dark style, adds Generate button
const ROOT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RSSHub</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0c0e12;color:#e8ecf2;
  display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem}
.logo{font-size:3rem;margin-bottom:.5rem}
h1{font-size:1.8rem;font-weight:800;margin-bottom:.5rem}
p{color:#98a2b3;font-size:.95rem;margin-bottom:2rem;text-align:center;max-width:420px;line-height:1.6}
.btn{display:inline-flex;align-items:center;gap:10px;padding:14px 32px;background:#f97316;
  color:#000;font-weight:700;border-radius:28px;text-decoration:none;font-size:1rem;
  font-family:system-ui,sans-serif;box-shadow:0 4px 20px rgba(249,115,22,.35);transition:opacity .15s}
.btn:hover{opacity:.85}
.links{margin-top:2.5rem;display:flex;gap:1.5rem;font-size:.82rem}
.links a{color:#626d82;text-decoration:none;transition:color .15s}
.links a:hover{color:#e8ecf2}
</style>
</head>
<body>
<div class="logo">📡</div>
<h1>RSSHub</h1>
<p>Your self-hosted RSS feed aggregator is running. Use the generator to build feed URLs for any supported platform.</p>
<a id="__gen" class="btn" href="/generate">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
Generate Feed URL</a>
<div class="links">
<a href="https://docs.rsshub.app/routes/" target="_blank" rel="noreferrer">Routes</a>
<a href="https://docs.rsshub.app/guide/parameters" target="_blank" rel="noreferrer">Parameters</a>
<a href="https://github.com/DIYgod/RSSHub" target="_blank" rel="noreferrer">GitHub</a>
</div>
<script>!function(){
var k=new URLSearchParams(location.search).get("key")||"";
if(k){document.cookie="rsshub_key="+encodeURIComponent(k)+";path=/;max-age=31536000;SameSite=Lax"}
if(!k){var m=document.cookie.match(/(?:^|; )rsshub_key=([^;]*)/);if(m)k=decodeURIComponent(m[1])}
if(k){document.getElementById("__gen").href="/generate?key="+encodeURIComponent(k)}
}()</script>
</body>
</html>`;

const _emit = http.Server.prototype.emit;
http.Server.prototype.emit = function(event, req, res) {
  if (event !== 'request') return _emit.apply(this, arguments);

  const url = req.url || '';

  // Serve generate page (linker) — requires ACCESS_KEY
  if (url === '/generate' || url.startsWith('/generate?')) {
    const params = new URL(url, 'http://localhost').searchParams;
    const key = params.get('key') || '';
    const expected = process.env.ACCESS_KEY || '';
    if (!expected || key !== expected) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied. Provide ?key=YOUR_ACCESS_KEY');
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(LINKER_HTML);
    return true;
  }

  // Serve custom root page with Generate button
  if (url === '/' || url === '/?' || url.startsWith('/?')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(ROOT_HTML);
    return true;
  }

  // Censys routes — WAF blocks HTML but REST API and /feed/ work
  if (url.startsWith('/censys')) {
    const censysPath = url.split('?')[0].replace(/\/$/, '');
    if (censysPath === '/censys' || censysPath === '/censys/feed') {
      handleRssProxy(url, res, 'https://censys.com/feed/', 'Censys');
      return true;
    }
    if (censysPath === '/censys/rapid-response') {
      handleCensysAdvisories(url, res);
      return true;
    }
  }

  // Unsloth blog — /unsloth
  if (url.startsWith('/unsloth')) {
    handleUnsloth(url, res);
    return true;
  }

  // Arcee AI blog — /arcee
  if (url.startsWith('/arcee')) {
    handleArcee(url, res);
    return true;
  }

  // Prime Intellect blog — /primeintellect
  if (url.startsWith('/primeintellect')) {
    handlePrimeIntellect(url, res);
    return true;
  }

  // Generic blog scraper — /generic/scrape/<encoded-url>
  if (url.startsWith('/generic/scrape/')) {
    handleGenericScrape(url, res);
    return true;
  }

  return _emit.apply(this, arguments);
};

// ============================================================
// Generic Blog Scraper — implemented in preload to bypass RSSHub's
// bundled route system which can't load custom .ts routes
// ============================================================
const cheerio = require('cheerio');

const CONTAINER_SELS = ['article','[class*="post"]','[class*="blog"]','[class*="article"]','[class*="entry"]','[class*="card"]','[class*="item"]','.collection-item','[role="article"]'];
const TITLE_SELS = ['h1 a','h2 a','h3 a','h4 a','h5 a','h2','h3','h4','h5','[class*="title"]','[class*="heading"]'];
const DATE_SELS = ['time','[datetime]','[class*="date"]','[class*="time"]','[class*="published"]','[class*="meta"]'];
const DATE_RES = [/(\d{4})-(\d{2})-(\d{2})/,/(\w+ \d{1,2},? \d{4})/,/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/,/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i,/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{4})/i];

function tryDate(text) {
  if (!text) return null;
  for (const re of DATE_RES) {
    const m = text.match(re);
    if (m) {
      if (re === DATE_RES[2]) {
        const p = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
        if (p) { let y=p[3]; if(y.length===2)y='20'+y; const d=new Date(y+'-'+p[1].padStart(2,'0')+'-'+p[2].padStart(2,'0')+'T12:00:00'); if(!isNaN(d))return d; }
      }
      // Add T12:00:00 to date-only strings to avoid timezone off-by-one
      const dateStr = m[0] + (/T\d/.test(m[0]) ? '' : ' 12:00:00');
      const d = new Date(dateStr); if (!isNaN(d)) return d;
    }
  }
  return null;
}

function resUrl(href, base) { try { return new URL(href, base).href; } catch { return href; } }

// Strategy 0: Extract from __NEXT_DATA__ JSON (Next.js sites)
// Many modern blogs use Next.js and embed structured post data in the page
function stratNextData($, base) {
  const script = $('#__NEXT_DATA__').html();
  if (!script) return [];
  let data;
  try { data = JSON.parse(script); } catch { return []; }

  // Walk the props tree to find arrays of post-like objects
  const posts = findPostArray(data);
  if (!posts || !posts.length) return [];

  return posts.map(p => {
    const title = p.title || p.headline || p.name || '';
    if (!title || title.length < 5) return null;
    const slug = p.urlAlias || p.slug || p.path || p.url || p.href || '';
    const link = slug ? resUrl(slug, base) : '';
    if (!link) return null;
    const dateStr = p.createdDate || p.created_at || p.publishedAt || p.date || p.published || p.createdAt || '';
    const pubDate = dateStr ? new Date(dateStr) : (p.created ? new Date(Number(p.created) * 1000) : null);
    const image = p.socialMediaMetaImage || p.featuredImage || p.thumbnail || p.image || p.cover || p.og_image || extractNestedImage(p) || null;
    const description = p.subtitle || p.excerpt || p.summary || p.description || p.teaser || '';
    return { title, link, pubDate: (pubDate && !isNaN(pubDate)) ? pubDate : null, image, description };
  }).filter(Boolean);
}

// Recursively find an array that looks like blog posts
function findPostArray(obj, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 6 || !obj || typeof obj !== 'object') return null;
  // Direct array of post objects
  if (Array.isArray(obj)) {
    if (obj.length >= 2 && obj[0] && typeof obj[0] === 'object' && (obj[0].title || obj[0].headline || obj[0].name)) {
      // Verify it has link-like fields too
      const first = obj[0];
      if (first.urlAlias || first.slug || first.path || first.url || first.href) return obj;
    }
    return null;
  }
  // Check known keys first
  for (const key of ['posts', 'articles', 'blogs', 'items', 'entries', 'results', 'nodes', 'edges', 'data']) {
    if (obj[key]) { const r = findPostArray(obj[key], depth + 1); if (r) return r; }
  }
  // Then recurse all keys
  for (const key of Object.keys(obj)) {
    if (['posts','articles','blogs','items','entries','results','nodes','edges','data'].includes(key)) continue;
    const val = obj[key];
    if (val && typeof val === 'object') { const r = findPostArray(val, depth + 1); if (r) return r; }
  }
  return null;
}

// Extract image URL from nested objects (heroImage, image, etc.)
function extractNestedImage(obj) {
  for (const key of ['heroImage', 'coverImage', 'featuredMedia', 'media']) {
    const val = obj[key];
    if (!val || typeof val !== 'object') continue;
    // Walk to find a URL string
    const url = findImageUrl(val, 0);
    if (url) return url;
  }
  return null;
}

function findImageUrl(obj, depth) {
  if (depth > 4) return null;
  if (typeof obj === 'string' && /^https?:\/\/.*\.(jpg|jpeg|png|webp|gif|svg)/i.test(obj)) return obj;
  if (typeof obj !== 'object' || !obj) return null;
  // Check common keys
  for (const k of ['url', 'src', 'srcset', 'href', 'default', 'original', 'large', 'medium']) {
    if (obj[k]) { const r = findImageUrl(obj[k], depth + 1); if (r) return r; }
  }
  if (Array.isArray(obj)) {
    for (const item of obj.slice(0, 3)) { const r = findImageUrl(item, depth + 1); if (r) return r; }
  } else {
    for (const k of Object.keys(obj).slice(0, 10)) { const r = findImageUrl(obj[k], depth + 1); if (r) return r; }
  }
  return null;
}

// Extract description snippet and image from the area around a blog item
function extractMeta($, el, base) {
  const $e = $(el);
  // Search the element itself and its parent container for image and description
  const $ctx = $e.parent().length ? $e.parent() : $e;

  // Image: look for img in the context, prefer og-style or large images
  let image = null;
  const $img = $ctx.find('img').first();
  if ($img.length) {
    const src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src') || '';
    if (src) image = resUrl(src, base);
  }

  // Description: find <p> text near the title, skip very short or date-like text
  let desc = '';
  const $ps = $ctx.find('p');
  $ps.each((_, p) => {
    if (desc) return;
    const t = $(p).text().trim();
    if (t.length >= 30 && t.length <= 500) desc = t;
  });
  // Fallback: any text in the container that isn't the title
  if (!desc) {
    const allText = $ctx.text().replace(/\s+/g, ' ').trim();
    const titleText = $e.find('h2, h3, h4').first().text().trim();
    const remaining = allText.replace(titleText, '').trim();
    if (remaining.length >= 30 && remaining.length <= 500) desc = remaining;
    else if (remaining.length > 500) desc = remaining.slice(0, 300) + '…';
  }

  return { image, description: desc };
}

function strat1($, base) {
  const items = [], seen = new Set();
  $('a:has(h2), a:has(h3), a:has(h4), a:has(h5)').each((_, el) => {
    const $e = $(el), href = $e.attr('href'), title = $e.find('h2, h3, h4, h5').first().text().trim();
    if (!title || !href || seen.has(href)) return; seen.add(href);
    const dt = $e.find(DATE_SELS.join(',')).first().text() || $e.parent().text() || $e.next().text();
    const meta = extractMeta($, el, base);
    items.push({ title, link: resUrl(href, base), pubDate: tryDate(dt), description: meta.description, image: meta.image });
  });
  return items;
}

function strat2($, base) {
  const items = [], seen = new Set();
  for (const sel of CONTAINER_SELS) {
    const cs = $(sel); if (cs.length < 3) continue;
    cs.each((_, el) => {
      const $e = $(el); let title='', link='';
      for (const ts of TITLE_SELS) { const $t=$e.find(ts).first(); if($t.length){title=$t.text().trim();link=$t.attr('href')||$t.closest('a').attr('href')||'';break;} }
      if (!link && $e.is('a')) link = $e.attr('href')||'';
      if (!title) { title=$e.find('a').first().text().trim(); link=link||$e.find('a').first().attr('href')||''; }
      if (!title||title.length<5||title.length>300||!link||seen.has(link)) return; seen.add(link);
      let pd = null;
      for (const ds of DATE_SELS) { const $d=$e.find(ds).first(); if($d.length){pd=tryDate($d.attr('datetime')||$d.text());if(pd)break;} }
      if (!pd) pd = tryDate($e.text());
      // For strat2, the container IS the context — extract directly from it
      let image = null;
      const $img = $e.find('img').first();
      if ($img.length) { const s=$img.attr('src')||$img.attr('data-src')||''; if(s) image=resUrl(s,base); }
      let desc = '';
      $e.find('p').each((_,p)=>{ if(desc)return; const t=$(p).text().trim(); if(t.length>=30&&t.length<=500) desc=t; });
      items.push({ title, link: resUrl(link, base), pubDate: pd, description: desc, image });
    });
    if (items.length >= 3) break; items.length = 0;
  }
  return items;
}

function strat3($, base) {
  const items = [], seen = new Set();
  $('h2 a, h3 a, h4 a, h5 a').each((_, el) => {
    const $e = $(el), href = $e.attr('href'), title = $e.text().trim();
    if (!title || !href || seen.has(href)) return; seen.add(href);
    const $ctx = $e.closest('div, section, li');
    const meta = extractMeta($, $ctx.get(0) || el, base);
    items.push({ title, link: resUrl(href, base), pubDate: tryDate($ctx.text()), description: meta.description, image: meta.image });
  });
  return items;
}

function escXml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function toRss(title, link, desc, items) {
  const rssItems = items.map(i => {
    let xml = `    <item>\n      <title>${escXml(i.title)}</title>\n      <link>${escXml(i.link)}</link>\n      <guid isPermaLink="true">${escXml(i.link)}</guid>\n`;
    if (i.pubDate) xml += `      <pubDate>${i.pubDate.toUTCString()}</pubDate>\n`;
    // Build HTML description with image + text (wrapped in CDATA to avoid double-escape)
    let descHtml = '';
    if (i.image) descHtml += `<img src="${i.image}" style="max-width:100%;height:auto;margin-bottom:8px;" />`;
    if (i.description) descHtml += `<p>${escXml(i.description)}</p>`;
    if (descHtml) xml += `      <description><![CDATA[${descHtml}]]></description>\n`;
    if (i.image) xml += `      <enclosure url="${escXml(i.image)}" type="image/jpeg" length="0" />\n`;
    xml += `    </item>`;
    return xml;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${escXml(title)}</title>\n    <link>${escXml(link)}</link>\n    <description>${escXml(desc)}</description>\n${rssItems}\n  </channel>\n</rss>`;
}

async function handleGenericScrape(url, res) {
  try {
    // Check access key
    const params = new URL(url, 'http://localhost').searchParams;
    const key = params.get('key') || '';
    const expected = process.env.ACCESS_KEY || '';
    if (expected && key !== expected) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied');
      return;
    }

    // Extract target URL from path: /generic/scrape/<encoded-url>
    const pathPart = url.split('?')[0];
    const encoded = pathPart.replace('/generic/scrape/', '');
    const targetUrl = decodeURIComponent(encoded);

    let parsed;
    try { parsed = new URL(targetUrl); } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid URL: ' + targetUrl);
      return;
    }

    // Fetch the page
    const resp = await fetch(targetUrl, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Try __NEXT_DATA__ first (structured data, best quality)
    let items = stratNextData($, parsed.origin);

    // Fall back to HTML heuristics
    if (items.length < 2) {
      // Strip noise before HTML strategies
      $('nav, header, footer, aside, [role="navigation"], [class*="sidebar"], [class*="footer"], [class*="header"], [class*="nav"]').remove();
      items = strat1($, parsed.origin);
      if (items.length < 2) items = strat2($, parsed.origin);
      if (items.length < 2) items = strat3($, parsed.origin);
    }

    // Deduplicate
    const uniq = [...new Map(items.map(i => [i.link, i])).values()];
    const filtered = uniq.filter(i => i.title.length >= 10 && !/^https?:\/\/[^/]+\/?$/.test(i.link));
    const final = filtered.length > 0 ? filtered : uniq.slice(0, 30);

    const pageTitle = $('title').text().trim() || $('h1').first().text().trim() || parsed.hostname;
    const rss = toRss(pageTitle, targetUrl, 'Auto-generated feed for ' + targetUrl, final);

    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'max-age=1800' });
    res.end(rss);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Scrape error: ' + (err.message || err));
  }
}

// RSS proxy for WAF-protected sites that have native feeds
async function handleRssProxy(url, res, feedUrl, name) {
  try {
    const params = new URL(url, 'http://localhost').searchParams;
    const key = params.get('key') || '';
    const expected = process.env.ACCESS_KEY || '';
    if (expected && key !== expected) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied');
      return;
    }
    const resp = await fetch(feedUrl, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    } });
    if (!resp.ok) throw new Error(`${name} feed returned HTTP ${resp.status}`);
    const xml = await resp.text();
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'max-age=1800' });
    res.end(xml);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`${name} feed proxy error: ${err.message || err}`);
  }
}

// Censys Rapid Response Advisories — fetched via WP REST API (advisory post type)
async function handleCensysAdvisories(url, res) {
  try {
    const params = new URL(url, 'http://localhost').searchParams;
    const key = params.get('key') || '';
    const expected = process.env.ACCESS_KEY || '';
    if (expected && key !== expected) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied');
      return;
    }

    const apiUrl = 'https://censys.com/wp-json/wp/v2/advisory?per_page=20&orderby=date&order=desc';
    const resp = await fetch(apiUrl, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    } });
    if (!resp.ok) throw new Error('Censys API returned HTTP ' + resp.status);
    const advisories = await resp.json();

    const items = advisories.map(a => {
      const title = (a.title && a.title.rendered) || '';
      const link = a.link || '';
      const pubDate = a.date_gmt ? new Date(a.date_gmt + 'Z') : null;
      // Extract first paragraph from content as description
      let desc = '';
      if (a.content && a.content.rendered) {
        const pMatch = a.content.rendered.match(/<p[^>]*>(.*?)<\/p>/s);
        if (pMatch) desc = pMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 300);
      }
      return { title, link, pubDate, description: desc, image: null };
    }).filter(i => i.title && i.link);

    const rss = toRss(
      'Censys Rapid Response Advisories',
      'https://censys.com/censys-arc/rapid-response-advisories/',
      'Censys rapid response security advisories for critical vulnerabilities',
      items
    );
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'max-age=1800' });
    res.end(rss);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Censys advisories error: ' + (err.message || err));
  }
}

// Prime Intellect blog — custom parser for their headless div-based layout
async function handlePrimeIntellect(url, res) {
  try {
    const params = new URL(url, 'http://localhost').searchParams;
    const key = params.get('key') || '';
    const expected = process.env.ACCESS_KEY || '';
    if (expected && key !== expected) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied');
      return;
    }

    const resp = await fetch('https://www.primeintellect.ai/blog', { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html',
    } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Each post is: <a class="block" href="/blog/slug"> with img[alt] and date in <p>
    const items = [];
    const seen = new Set();
    $('a[href^="/blog/"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href');
      if (!href || href === '/blog' || href === '/blog/' || seen.has(href)) return;
      seen.add(href);

      // Title from img alt or from the text-base div
      const img = $a.find('img').first();
      const title = (img.attr('alt') || '').trim()
        || $a.find('.text-base, .text-lg, .text-xl').first().text().trim()
        || $a.text().replace(/\s+/g, ' ').trim().slice(0, 100);
      if (!title || title.length < 10) return;

      // Date from small text paragraph
      const dateText = $a.find('p').last().text().trim();
      const pubDate = dateText ? new Date(dateText) : null;

      // Image from srcSet or src
      let image = null;
      if (img.length) {
        const srcSet = img.attr('srcset') || '';
        const srcMatch = srcSet.match(/(\/_next\/image\?url=[^\s]+\s+1080w)/);
        if (srcMatch) {
          image = 'https://www.primeintellect.ai' + srcMatch[1].replace(/\s+\d+w$/, '');
        } else {
          const src = img.attr('src') || '';
          if (src) image = src.startsWith('/') ? 'https://www.primeintellect.ai' + src : src;
        }
      }

      // Category tag
      const category = $a.find('.text-sm').first().text().trim();
      const desc = category ? category : '';

      items.push({
        title,
        link: 'https://www.primeintellect.ai' + href,
        pubDate: (pubDate && !isNaN(pubDate)) ? pubDate : null,
        image,
        description: desc,
      });
    });

    const rss = toRss(
      'Prime Intellect Blog',
      'https://www.primeintellect.ai/blog',
      'Prime Intellect - open source AI research and decentralized training',
      items
    );
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'max-age=1800' });
    res.end(rss);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Prime Intellect error: ' + (err.message || err));
  }
}

// Arcee AI blog — Webflow site with fs-list-field attributes
// Structure: <a class="blog-post_link" href="/blog/slug">
//   <img .../> (thumbnail)
//   <div class="blog-post_header-details">
//     <div fs-list-field="category">Category</div> • <div>April 14, 2026</div>
//   </div>
//   <h2 fs-list-field="title">Title</h2>
//   <p fs-list-field="desc">Description</p>
// </a>
async function handleArcee(url, res) {
  try {
    const params = new URL(url, 'http://localhost').searchParams;
    const key = params.get('key') || '';
    const expected = process.env.ACCESS_KEY || '';
    if (expected && key !== expected) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied');
      return;
    }

    const resp = await fetch('https://www.arcee.ai/blog', { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html',
    } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const html = await resp.text();
    const $ = cheerio.load(html);

    const items = [];
    const seen = new Set();
    $('a.blog-post_link[href^="/blog/"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href');
      if (!href || seen.has(href)) return;
      seen.add(href);

      const title = $a.find('[fs-list-field="title"]').text().trim();
      if (!title || title.length < 5) return;

      const description = $a.find('[fs-list-field="desc"]').text().trim();
      const category = $a.find('[fs-list-field="category"]').text().trim();

      // Date is the last .text-size-tiny in the header-details that looks like a date
      let pubDate = null;
      $a.find('.blog-post_header-details .text-size-tiny').each((_, d) => {
        const t = $(d).text().trim();
        // Match "April 14, 2026" or "October 31, 2025" etc.
        if (/^[A-Z][a-z]+ \d{1,2},? \d{4}$/.test(t)) {
          pubDate = new Date(t);
        }
      });

      // Image
      let image = null;
      const $img = $a.find('img').first();
      if ($img.length) {
        const src = $img.attr('src') || '';
        if (src) image = src.startsWith('/') ? 'https://www.arcee.ai' + src : src;
      }

      items.push({
        title,
        link: 'https://www.arcee.ai' + href,
        pubDate: (pubDate && !isNaN(pubDate)) ? pubDate : null,
        image,
        description: description || category || '',
      });
    });

    const rss = toRss(
      'Arcee AI Blog',
      'https://www.arcee.ai/blog',
      'Arcee AI - open source language models, merging, and enterprise AI',
      items
    );
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'max-age=1800' });
    res.end(rss);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Arcee error: ' + (err.message || err));
  }
}

// Unsloth blog — no headings, titles are plain <a> link text with sibling <span> dates
// Structure: <a href="/blog/slug">Title text</a><span class="w-text">Mar 13, 2026</span>
// Image link: separate <a href="/blog/slug"><img src="..."/></a> before the text link
async function handleUnsloth(url, res) {
  try {
    const params = new URL(url, 'http://localhost').searchParams;
    const key = params.get('key') || '';
    const expected = process.env.ACCESS_KEY || '';
    if (expected && key !== expected) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied');
      return;
    }

    const resp = await fetch('https://unsloth.ai/blog', { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html',
    } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const html = await resp.text();
    const $ = cheerio.load(html);

    const items = [];
    const seen = new Set();

    // Find all text links to /blog/ (not image links)
    $('a[href^="/blog/"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href');
      if (!href || href === '/blog' || href === '/blog/' || seen.has(href)) return;

      // Skip image-only links (contain <img> but no meaningful text)
      const text = $a.text().trim();
      if (!text || text.length < 5) return;

      seen.add(href);
      const title = text;

      // Date: look for sibling span.w-text with date pattern
      let pubDate = null;
      const $parent = $a.parent();
      $parent.find('span').each((_, sp) => {
        const st = $(sp).text().trim();
        if (/^[A-Z][a-z]{2,8} \d{1,2},? \d{4}$/.test(st)) {
          // Add T12:00:00 to avoid timezone off-by-one when parsing dates without time
          pubDate = new Date(st + ' 12:00:00');
        }
      });

      // Image: find the image link with same href in a nearby container
      let image = null;
      const $container = $a.closest('[class*="w-box"]').parent();
      const $imgLink = $container.find(`a[href="${href}"] img`).first();
      if ($imgLink.length) {
        const src = $imgLink.attr('src') || '';
        if (src) image = src.startsWith('/') ? 'https://unsloth.ai' + src.split('?')[0] + '?width=640&quality=80&format=auto' : src;
      }

      items.push({
        title,
        link: 'https://unsloth.ai' + href,
        pubDate: (pubDate && !isNaN(pubDate)) ? pubDate : null,
        image,
        description: '',
      });
    });

    const rss = toRss(
      'Unsloth Blog',
      'https://unsloth.ai/blog',
      'Unsloth - fast and memory-efficient LLM fine-tuning',
      items
    );
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'max-age=1800' });
    res.end(rss);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Unsloth error: ' + (err.message || err));
  }
}
