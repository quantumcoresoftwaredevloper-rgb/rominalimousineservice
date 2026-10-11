#!/usr/bin/env bash
#
# Production entrypoint for the API. PM2 runs this, not `node src/index.js`
# directly.
#
# Why this exists: PM2 spawns the app from its own daemon's environment, and
# the `.env` file beside the app was never reliably loaded from it. The result
# was a crash loop with `TypeError: JwtStrategy requires a secret or key` —
# passport builds its strategy at module load, so it saw `JWT_ACCESS_SECRET`
# as undefined. Sourcing `.env` here, in the shell, exports every variable
# before Node starts, which is the only ordering that works. `dotenv` inside
# the app then has nothing left to do.
#
# No secret is ever written in this file. `.env` stays gitignored and lives only
# on the server; `set -a` exports whatever it contains.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  . ./.env
  set +a
fi

exec node src/index.js