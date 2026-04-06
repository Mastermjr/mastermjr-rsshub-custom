FROM ghcr.io/diygod/rsshub:latest

# Copy custom route source files
COPY lib/routes/ /app/lib/routes/

# Copy route registration script, linker page, and preload hook
COPY register-routes.cjs /app/register-routes.cjs
COPY linker.html /srv/linker.html
COPY preload.cjs /app/preload.cjs

# Register custom routes: patches assets/build/routes.js and copies
# processed route files to /app/custom-routes/ with resolved imports
RUN node /app/register-routes.cjs

ENV NODE_ENV=production
CMD ["node", "--max-http-header-size=32768", "--require", "/app/preload.cjs", "index.mjs"]
