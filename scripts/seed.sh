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

# Uploads belong to a user: sign up the demo account, or log in if it exists.
EMAIL="${DEMO_EMAIL:-demo@example.com}"
PASSWORD="${DEMO_PASSWORD:-demo-password-123}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
CREDS="{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"

auth() {
  curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -H 'content-type: application/json' -d "$CREDS" "$API_URL/auth/$1"
}

status=$(auth signup)
if [ "$status" = "409" ]; then
  status=$(auth login)
  if [ "$status" != "200" ]; then
    echo "$EMAIL already exists with a different password. Set DEMO_PASSWORD, or use another DEMO_EMAIL." >&2
    exit 1
  fi
elif [ "$status" != "201" ]; then
  echo "Sign-up failed (HTTP $status). Check the API logs." >&2
  exit 1
fi

if curl -fsS -b "$JAR" "$API_URL/documents" | grep -q '"label"'; then
  echo "$EMAIL already has documents; skipping. Delete them in the UI to re-seed."
  exit 0
fi

upload() {
  printf 'Uploading %s (%s)... ' "$(basename "$2")" "$1"
  label=$(curl -fsS -b "$JAR" -F "file=@$2" "$API_URL/documents?kind=$1" | sed -n 's/.*"label":"\([^"]*\)".*/\1/p')
  echo "$label"
}

upload resume "$DIR/resume-jordan-ellis.md"
for job in "$DIR"/job-*.md; do
  upload job "$job"
done
echo "Seeded. Open http://localhost:8080 (Docker) or http://localhost:5173 (pnpm dev)"
echo "and log in as $EMAIL / $PASSWORD"
