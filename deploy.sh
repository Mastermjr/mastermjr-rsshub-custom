#!/bin/bash
# deploy.sh — Builds the custom RSSHub Docker image via Cloud Build and deploys to Cloud Run.
# Requires MY_PROJECT and MY_ACCESS_KEY env vars. MY_REGION defaults to us-central1.
set -euo pipefail

# === EDIT THESE (or set as env vars before running) ===
MY_PROJECT="${MY_PROJECT:?Set MY_PROJECT env var}"
MY_REGION="${MY_REGION:-us-central1}"
MY_ACCESS_KEY="${MY_ACCESS_KEY:?Set MY_ACCESS_KEY env var}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="${SCRIPT_DIR}/GITHUB_ACCESS_TOKEN_FOR_RSSHUB.secret"
if [[ -f "$TOKEN_FILE" ]]; then
  GITHUB_ACCESS_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
else
  echo "Warning: ${TOKEN_FILE} not found — GitHub routes will be rate-limited"
  GITHUB_ACCESS_TOKEN=""
fi

SERVICE_NAME="rsshub"
IMAGE="gcr.io/${MY_PROJECT}/rsshub-custom"

echo "Building custom RSSHub image..."
gcloud builds submit \
  --config=cloudbuild.yaml \
  --project "${MY_PROJECT}" \
  --region "${MY_REGION}"

echo "Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --region "${MY_REGION}" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 60 \
  --concurrency 10 \
  --set-env-vars "ACCESS_KEY=${MY_ACCESS_KEY},CACHE_EXPIRE=1800,CACHE_TYPE=memory,GITHUB_ACCESS_TOKEN=${GITHUB_ACCESS_TOKEN}"

echo ""
echo "Done! Your custom routes are live."
echo "Test with: echo \"https://\$MY_DOMAIN/liquidai/blog?key=\$MY_ACCESS_KEY\""
echo "Generate: echo \"https://\$MY_DOMAIN/generate?key=\$MY_ACCESS_KEY\""
