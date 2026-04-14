FROM ghcr.io/diygod/rsshub:latest

# Copy linker page and preload hook
# preload.cjs handles /generate, /, and /generic/scrape/ directly
COPY linker.html /srv/linker.html
COPY preload.cjs /app/preload.cjs

ENV NODE_ENV=production
CMD ["node", "--max-http-header-size=32768", "--require", "/app/preload.cjs", "dist/index.mjs"]
