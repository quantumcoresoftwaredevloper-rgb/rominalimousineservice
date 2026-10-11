#!/usr/bin/env bash
#
# Manual deploy fallback — run this from your Mac, not the VPS.
#
#   ./scripts/deploy-interserver.sh
#
# The primary path is .github/workflows/deploy.yml, which runs on the
# self-hosted Actions runner on the VPS. Use this when the runner is down or
# you want to ship without pushing.
#
# It runs from your machine on purpose: the VPS has no git installed (the
# Actions runner's actions/checkout falls back to a REST tarball download,
# which is why deploys there are rsync-based), so there is no checkout on the
# box to build from.
#
# `rsync --delete` erases whatever is at the destination that is not in the
# source. The paths below are the one part of this script that can destroy the
# other site on the box, so they are hardcoded and asserted below.

set -euo pipefail

HOST="${DEPLOY_HOST:-root@162.35.185.229}"
WEB_DEST=/var/www/rominalimousineservice.com
API_DEST=/home/deploy/api-romina
PM2_NAME=romina-api
API_PORT=5002

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Refuse to run against the wrong box. The names below are this project's; if
# they are missing you are pointed at the wrong VPS and rsync --delete is about
# to do something unrecoverable.
echo "==> Checking $HOST is the right box"
ssh "$HOST" 'test -d /var/www/ellicottcityairporttaxi.com && test -f /etc/nginx/sites-available/api.ellicottcityairporttaxi.com' \
  || { echo "error: $HOST does not look like the Romina VPS — aborting"; exit 1; }

echo "==> 1/4 client build (same-origin: VITE_API_URL is left empty)"
( cd client && npm ci && VITE_API_URL='' npm run build )
[ -f client/dist/index.html ] || { echo "error: build produced no dist/index.html"; exit 1; }

echo "==> 2/4 client -> $WEB_DEST"
# --delete only removes files inside WEB_DEST. It is never a parent of it.
ssh "$HOST" "sudo mkdir -p '$WEB_DEST'"
rsync -az --delete client/dist/ "$HOST:$WEB_DEST/"
ssh "$HOST" "sudo chown -R runner:runner '$WEB_DEST'"

echo "==> 3/4 server -> $API_DEST"
ssh "$HOST" "sudo mkdir -p '$API_DEST/logs'"
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'logs' \
  server/ "$HOST:$API_DEST/"
ssh "$HOST" "sudo chown -R runner:runner '$API_DEST'"

echo "==> 4/4 pm2 restart $PM2_NAME"
# .env is excluded from rsync above — it lives only on the server.
ssh "$HOST" "sudo test -f '$API_DEST/.env'" \
  || { echo "error: $API_DEST/.env is missing on the server — create it first"; exit 1; }

# Delete-then-start rather than `pm2 restart`: restart replays the script path
# recorded when the process was first created, and cannot recover if that file
# has moved. Starting fresh means the recorded path always matches disk.
ssh "$HOST" "sudo bash -c 'cd $API_DEST \
  && chmod +x scripts/start.sh \
  && mkdir -p logs \
  && npm ci --omit=dev \
  && pm2 delete $PM2_NAME >/dev/null 2>&1 || true; \
  cd $API_DEST \
  && pm2 start scripts/start.sh --name $PM2_NAME \
  && pm2 save'"

echo "==> health"
for _ in $(seq 1 15); do
  if ssh "$HOST" "curl -sf http://127.0.0.1:$API_PORT/api/health" | grep -q '"ok"'; then
    echo "API healthy on :$API_PORT"
    break
  fi
  sleep 2
done
ssh "$HOST" "pm2 list | grep $PM2_NAME"

echo
echo "Done. Other app on this box is 'ellicott-api' — confirm it is still online."
ssh "$HOST" "pm2 list | grep -E 'ellicott-api|romina-api'"