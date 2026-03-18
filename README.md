# rsshub-custom

Custom RSSHub instance with a **generic blog scraper** and additional routes.
Extends the official `diygod/rsshub` Docker image, deployed on Google Cloud Run behind Cloudflare.

> For architecture, development details, and adding custom routes, see [CLAUDE.md](CLAUDE.md).

## Quickstart

### Prerequisites
- `gcloud` CLI installed and authenticated
- A GCP project with billing enabled
- A domain with DNS you control (e.g., Cloudflare)

### 1. Set environment variables

```bash
env | grep -i MY_   # check what's already set

export MY_PROJECT="<your-gcp-project>"
export MY_ACCESS_KEY="<your-access-key>"
export MY_REGION="us-central1"              # optional, defaults to us-central1
export MY_DOMAIN="<feeds.yourdomain.com>"
```

### 2. Clone and deploy

```bash
git clone <repo-url> && cd rsshub-custom
bash deploy.sh
```

### 3. Get your Cloud Run URL

```bash
CLOUD_RUN_URL=$(gcloud run services describe rsshub \
  --region=$MY_REGION --format='value(status.url)')
echo $CLOUD_RUN_URL
```

### 4. Configure Cloudflare DNS

1. Log into Cloudflare dashboard → select your domain
2. **DNS → Records → Add Record**
   - Type: `CNAME`
   - Name: `feeds` (or your preferred subdomain)
   - Target: the hostname from step 3 (without `https://`)
   - Proxy status: **Proxied** (orange cloud ON)
3. **SSL/TLS** → set encryption mode to **Full (strict)**
4. *(Optional)* **Rules → Page Rules** → add rule for `$MY_DOMAIN/*` with Cache Level: Standard

### 5. (Optional) Map custom domain in Cloud Run

```bash
gcloud run domain-mappings create --service=rsshub \
  --domain=$MY_DOMAIN --region=$MY_REGION
```

### 6. Test

```bash
curl -s "https://$MY_DOMAIN/liquidai/blog?key=$MY_ACCESS_KEY" | head -20
```

## Using the Generic Scraper

No code changes needed — just URL-encode any blog page:

```bash
python3 -c "import urllib.parse; print(urllib.parse.quote('https://example.com/blog', safe=''))"
# Use: https://$MY_DOMAIN/generic/scrape/<output>?key=$MY_ACCESS_KEY
```

### When to use which

| Situation | What to use |
|-----------|-------------|
| Site has a built-in RSSHub route ([docs](https://docs.rsshub.app/routes/)) | Use it: `/stanford/hazyresearch/blog` |
| Site is a normal blog page | Generic scraper: `/generic/scrape/<encoded-url>` |
| Generic scraper doesn't work well | Write a custom route (see [CLAUDE.md](CLAUDE.md)) |

## Custom Routes

| Route | Site | Example |
|-------|------|---------|
| `/liquidai/blog/:category?` | liquid.ai blog | `/liquidai/blog` or `/liquidai/blog/Models` |

## Useful Commands

```bash
# Check logs
gcloud run services logs read rsshub --region=$MY_REGION --limit=30

# Update env vars without redeploying
gcloud run services update rsshub --region=$MY_REGION \
  --set-env-vars "ACCESS_KEY=$MY_ACCESS_KEY,CACHE_EXPIRE=1800,CACHE_TYPE=memory"

# Redeploy after code changes
bash deploy.sh
```
