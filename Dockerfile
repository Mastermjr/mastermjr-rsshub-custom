FROM ghcr.io/diygod/rsshub:latest

# Copy custom routes into the RSSHub routes directory
COPY lib/routes/ /app/lib/routes/
