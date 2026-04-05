FROM ghcr.io/diygod/rsshub:latest

# Copy custom routes into the RSSHub routes directory
COPY lib/routes/ /app/lib/routes/

# Copy linker page and preload hook
COPY linker.html /srv/linker.html
COPY preload.cjs /app/preload.cjs

# RSSHub's npm start sets NODE_OPTIONS which overwrites ours, so we set CMD directly
# combining RSSHub's original flags with our preload
ENV NODE_ENV=production
CMD ["node", "--max-http-header-size=32768", "--require", "/app/preload.cjs", "dist/index.mjs"]
