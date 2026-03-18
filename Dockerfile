FROM diygod/rsshub:2026-03-17

# Copy custom routes into the RSSHub routes directory
COPY lib/routes/ /app/lib/routes/
