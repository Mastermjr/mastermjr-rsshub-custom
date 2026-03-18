# CLAUDE.md

## Project Overview

This is a custom RSSHub instance that extends the official `diygod/rsshub` Docker image with additional routes. It runs on Google Cloud Run behind a Cloudflare proxy.

## Architecture

```
RSS readers
        |
        v
  Cloudflare ($MY_DOMAIN)     <- rate limiting, DDoS protection, caching
        |
        v
  Google Cloud Run ($MY_REGION) <- max-instances=1, ACCESS_KEY gated
        |
        v
  RSSHub (diygod/rsshub + custom routes)
```

- **GCP Project**: `$MY_PROJECT`
- **Region**: `$MY_REGION` (default: `us-central1`)
- **Billing**: Billing cap managed externally
- **Auth**: `ACCESS_KEY` env var — all feed URLs require `?key=<key>`

## Environment Variables

All commands and examples use `$VARIABLE` syntax — never hardcode instance-specific values.

| Variable | Required | Description |
|----------|----------|-------------|
| `MY_PROJECT` | Yes | GCP project ID |
| `MY_ACCESS_KEY` | Yes | Feed access key |
| `MY_REGION` | No | GCP region (default: `us-central1`) |
| `MY_DOMAIN` | No | Feed domain (e.g., `feeds.example.com`) |

Check what's set: `env | grep -i MY_`

## Repo Structure

```
rsshub-custom/
├── Dockerfile              <- FROM diygod/rsshub, copies custom routes
├── deploy.sh               <- builds image via Cloud Build, deploys to Cloud Run
├── README.md
├── CLAUDE.md               <- this file
├── .gitignore
└── lib/routes/
    ├── generic/            <- generic scraper for any URL
    │   ├── namespace.ts
    │   └── scrape.ts       <- auto-detects blog posts using 3 heuristic strategies
    └── liquidai/           <- site-specific route (better quality than generic)
        ├── namespace.ts
        └── blog.ts
```

## Key Commands

```bash
# Deploy after making changes
bash deploy.sh

# Check logs
gcloud run services logs read rsshub --region=$MY_REGION --limit=30

# Update env vars without redeploying
gcloud run services update rsshub \
  --region=$MY_REGION \
  --set-env-vars "ACCESS_KEY=$MY_ACCESS_KEY,CACHE_EXPIRE=1800,CACHE_TYPE=memory"

# Re-enable billing after kill switch fires
gcloud billing projects link $MY_PROJECT --billing-account="<billing-id>"
```

## Feed URL Patterns

```
# Built-in RSSHub route (1000+ sites supported)
https://$MY_DOMAIN/stanford/hazyresearch/blog?key=$MY_ACCESS_KEY

# Generic scraper (any URL, no code changes needed)
https://$MY_DOMAIN/generic/scrape/<url-encoded-blog-url>?key=$MY_ACCESS_KEY

# Site-specific custom route
https://$MY_DOMAIN/liquidai/blog?key=$MY_ACCESS_KEY
```

## How to Add a New Site

### Option 1: Generic scraper (no code, no deploy)

Just URL-encode the blog page and use it:

```bash
python3 -c "import urllib.parse; print(urllib.parse.quote('https://example.com/blog', safe=''))"
# Use: /generic/scrape/<output>?key=$MY_ACCESS_KEY
```

### Option 2: Custom route (better quality, requires deploy)

1. Create `lib/routes/<sitename>/namespace.ts`:
```typescript
import type { Namespace } from '@/types';
export const namespace: Namespace = {
    name: 'Site Name',
    url: 'www.example.com',
};
```

2. Create `lib/routes/<sitename>/blog.ts`:
```typescript
import { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/blog',
    categories: ['blog'],
    example: '/sitename/blog',
    name: 'Blog',
    maintainers: ['mastermjr'],
    handler,
    url: 'www.example.com/blog',
};

async function handler() {
    const response = await ofetch('https://www.example.com/blog');
    const $ = load(response);
    const items = $('a:has(h2)')  // adjust CSS selector per site
        .toArray()
        .map((el) => {
            const $el = $(el);
            return {
                title: $el.find('h2').first().text().trim(),
                link: new URL($el.attr('href')!, 'https://www.example.com').href,
                pubDate: parseDate($el.find('time').text().trim()),
            };
        })
        .filter((item) => item.title);

    return {
        title: 'Site Name Blog',
        link: 'https://www.example.com/blog',
        item: items,
    };
}
```

3. Run `bash deploy.sh`

## Generic Scraper Strategies (scrape.ts)

The generic scraper tries three approaches in order:

1. **Links with headings** — `<a>` tags containing `<h2>` or `<h3>` (most blogs)
2. **Repeated containers** — 3+ matching `article`, `.post`, `.card` elements
3. **Heading links** — bare `h2 a` / `h3 a` elements

Before scraping, it strips `nav`, `header`, `footer`, `aside`, and sidebar elements.
Dates are matched against ISO, US, European, and M.D.YY patterns.

## Cloud Run Constraints

| Setting | Value | Why |
|---------|-------|-----|
| `max-instances` | 1 | Prevents runaway scaling/cost |
| `min-instances` | 0 | Scale to zero when idle |
| `memory` | 512Mi | RSSHub crashes at 256Mi |
| `timeout` | 60s | Some scrapes need >30s |
| `concurrency` | 10 | Limits parallel requests per instance |
| `CACHE_EXPIRE` | 1800 | 30min cache, reduces scraping |

## RSSHub Docs

- Routes: https://docs.rsshub.app/routes/
- Parameters (filtering, format): https://docs.rsshub.app/guide/parameters
- Creating routes: https://docs.rsshub.app/joinus/new-rss/start-code
- Config/env vars: https://docs.rsshub.app/deploy/config
