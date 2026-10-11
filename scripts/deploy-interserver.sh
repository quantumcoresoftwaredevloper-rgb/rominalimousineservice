#!/usr/bin/env bash
#
# Manual deploy fallback — the primary path is .github/workflows/deploy.yml,
# which runs on the self-hosted Actions runner on the VPS. Use this when you
# want to ship without pushing, or when the runner is unavailable.
#
# Run as root on the VPS from a checkout of the repo:
#   bash scripts/deploy-interserver.sh
#
# Targets are hardcoded and guarded. `rsync --delete` erases whatever is in the
# destination that is not in the source, so these paths are the one part of this
# script that can destroy the other site on the box if they are wrong.

set -euo pipefail

WEB_DEST=/var/www/rominalimousineservice.com
API_DEST=/home/deploy/api-romina
PM2_NAME=romina-api
API_PORT=5002

echo "==> Refusing to touch a box that does not look like ours"
[ "$(id -u)" = "0" ] || { echo "error: run as root"; exit 1; }
case "$WEB_DEST" in
  /var/www/*) ;;
  *) echo "error: WEB_DEST must live under /var/www — got '$WEB_DEST'"; exit 1 ;;
esac
case "$API_DEST" in
  /home/deploy/*) ;;
  *) echo "error: API_DEST must live under /home/deploy — got '$API_DEST'"; exit 1 ;;
esac

echo "==> 1/5 client build (same-origin: VITE_API_URL is left empty)"
( cd client && npm ci && VITE_API_URL='' npm run build )
[ -f client/dist/index.html ] || { echo "error: no dist/index.html"; exit 1; }

echo "==> 2/5 client -> $WEB_DEST"
mkdir -p "$WEB_DEST"
rsync -az --delete client/dist/ "$WEB_DEST"/
chown -R runner:runner "$WEB_DEST" 2>/dev/null || true

echo "==> 3/5 server -> $API_DEST"
mkdir -p "$API_DEST"
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'logs' \
  server/ "$API_DEST"/

echo "==> 4/5 pm2 restart $PM2_NAME"
# .env is deliberately excluded from rsync — it lives only on the server.
[ -f "$API_DEST/.env" ] || { echo "error: $API_DEST/.env is missing — create it before deploying"; exit 1; }
bash -c "cd $API_DEST && chmod +x scripts/start.sh && mkdir -p logs && npm ci --omit=dev"
pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
bash -c "cd $API_DEST && pm2 start scripts/start.sh --name $PM2_NAME"
pm2 save

echo "==> 5/5 health"
sleep 2
curl -sf "http://127.0.0.1:${API_PORT}/api/health" && echo
curl -sf http://127.0.0.1/api/health >/dev/null 2>&1 \
  && echo "nginx -> API ok" \
  || echo "nginx vhost not serving yet (expected before DNS + cert)"

echo
echo "Done. Check: pm2 list | grep $PM2_NAME"