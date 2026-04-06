FROM ghcr.io/diygod/rsshub:latest

# Copy custom route source files (kept in lib/routes/ for the register script to read)
COPY lib/routes/ /app/lib/routes/

# Copy route registration script, linker page, and preload hook
COPY register-routes.cjs /app/register-routes.cjs
COPY linker.html /srv/linker.html
COPY preload.cjs /app/preload.cjs

# Register custom routes into the pre-built routes.js at build time
# This patches dist/assets/build/routes.js so RSSHub discovers our routes in production
RUN node /app/register-routes.cjs

ENV NODE_ENV=production
CMD ["node", "--max-http-header-size=32768", "--require", "/app/preload.cjs", "dist/index.mjs"]
