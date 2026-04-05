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
<script>!function(){var k=new URLSearchParams(location.search).get("key");if(k)document.getElementById("__gen").href="/generate?key="+encodeURIComponent(k)}()</script>
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

  return _emit.apply(this, arguments);
};
