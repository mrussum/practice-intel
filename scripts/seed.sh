#!/bin/sh
# Loads the fictional fixtures (one resume, three job descriptions) through the
# public upload API, so seeding exercises the same path as the UI.
#   pnpm seed                                  # API on localhost:3001
#   docker compose --profile seed run --rm seed
set -eu

API_URL="${API_URL:-http://localhost:3001}"
DIR="${FIXTURES_DIR:-$(dirname "$0")/../evals/fixtures}"

if ! curl -fsS "$API_URL/ready" >/dev/null; then
  echo "API not ready at $API_URL. Start it first (docker compose up, or pnpm dev)." >&2
  exit 1
fi

if curl -fsS "$API_URL/documents" | grep -q '"label"'; then
  echo "Documents already exist; skipping. Delete them in the UI to re-seed."
  exit 0
fi

upload() {
  printf 'Uploading %s (%s)... ' "$(basename "$2")" "$1"
  label=$(curl -fsS -F "file=@$2" "$API_URL/documents?kind=$1" | sed -n 's/.*"label":"\([^"]*\)".*/\1/p')
  echo "$label"
}

upload resume "$DIR/resume-jordan-ellis.md"
for job in "$DIR"/job-*.md; do
  upload job "$job"
done
echo "Seeded. Open http://localhost:8080 (Docker) or http://localhost:5173 (pnpm dev)."
