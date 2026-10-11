# Deploy — Romina Limousine Service

Single source of truth for deploying this app. `INTERSERVER_SIMPLE_GUIDE.md`
and `INTERSERVER_DEPLOYMENT_GUIDE.md` were written before the box was audited
and contradict what is actually running — do not follow them.

**Target:** `root@162.35.185.229` (`vps3707281`) · Ubuntu 24.04.5 LTS · 2 cores ·
5.8 GB RAM · 102 GB free · Node 22.23.3 · MongoDB 8.0.32 · PM2 7.0.4

---

## This box is shared

`ellicottcityairporttaxi.com` already runs here. Everything below is chosen so
the two apps cannot collide.

| | ellicott (existing) | romina (this app) |
|---|---|---|
| Domain | `ellicottcityairporttaxi.com` | `rominalimousineservice.com` |
| PM2 name | `ellicott-api` | `romina-api` |
| Port | 5001 | **5002** |
| App dir | `/home/deploy/api/` | `/home/deploy/api-romina/` |
| Web root | `/var/www/ellicottcityairporttaxi.com/` | `/var/www/rominalimousineservice.com/` |
| Mongo DB | `ellicottaxi` | `ridetaxi` |
| Nginx | `ellicottcityairporttaxi.com` + `api.` subdomain | `rominalimousineservice.com` (single host) |

### Three things that are shared and worth knowing

**MongoDB has no authentication.** `MONGO_URI=mongodb://localhost:27017/ridetaxi`
with no credentials, matching the existing app. Anything that can open a socket
to 27017 can read both databases. Turning on auth would break the other site's
connection string, so it is left alone deliberately — revisit it as a joint
change, not from this repo.

**`git` is not installed on the VPS.** `actions/checkout` falls back to a REST
tarball download, which is why the deploy is rsync-based and why no work
directory contains a `.git`. Any `git pull`-based deploy strategy would fail
here silently.

**The Actions runner is bound to one repo.** The runner at
`/home/runner/actions-runner` is registered to `ellicottcityairporttaxi-web`.
GitHub scopes self-hosted runners to a single repository, so **this repo needs
its own runner registration** — without it, `deploy.yml` jobs queue forever and
never run.

---

## Architecture: same-origin

The client is built with `VITE_API_URL` empty, so it calls `/api` on its own
domain and nginx proxies to the Node process. One origin means there is no CORS
configuration at all.

This differs from ellicott, which runs the API on an `api.` subdomain and builds
with an absolute URL. Same-origin was chosen here because it needs one DNS
record instead of two and removes a class of build-time misconfiguration.

`VITE_*` values are **inlined at build time**. Changing `VITE_API_URL` or a
publishable key is a rebuild and a redeploy, never a server restart.

---

## What is already done on the box

- `nginx` vhost `/etc/nginx/sites-available/rominalimousineservice.com`, enabled, HTTP only (TLS not yet issued)
- `/home/deploy/api-romina/` with `.env` (mode 600) and `logs/`
- `/var/www/rominalimousineservice.com/` serving the built SPA
- `romina-api` running under the root PM2 daemon on port 5002
- `ridetaxi` MongoDB seeded
- swap raised to 3 GB (added `/swapfile2`; `/dev/sda3` is a 1 GB partition and resizing it means partition surgery)

### `/home/deploy/api-romina/.env`

Set via SSH — never committed. Required values:

```
NODE_ENV=production
PORT=5002
MONGO_URI=mongodb://localhost:27017/ridetaxi
JWT_ACCESS_SECRET=<48 random bytes hex>
JWT_REFRESH_SECRET=<different 48 random bytes hex>
CLIENT_ORIGIN=https://rominalimousineservice.com
APP_URL=https://rominalimousineservice.com
TRUST_PROXY=true
```

`TRUST_PROXY=true` requires nginx to send `X-Forwarded-For`; the vhost does. Without
it the rate limiter treats every visitor as one IP.

---

## Remaining steps

### 1. DNS

In the InterServer panel for `rominalimousineservice.com`. **Change only `@` and
`www`** — leave every mail record alone or existing email breaks (see below).

| Type | Host | Value |
|---|---|---|
| A | `@` | `162.35.185.229` |
| A | `www` | `162.35.185.229` |

**Do not touch:** `mail`, `smtp`, `webmail`, `autodiscover`, `ftp`, `cpanel`, the
SPF TXT record, or the MX records. Those stay on `173.214.163.18` so the existing
mailboxes keep working. There is no mail server on the VPS.

### 2. HTTPS

Only after DNS resolves — certbot's HTTP-01 challenge needs the domain to reach
this box.

```bash
sudo certbot --nginx -d rominalimousineservice.com -d www.rominalimousineservice.com
```

Certbot edits only the vhost it matches. After it runs, confirm the other site:

```bash
curl -s https://api.ellicottcityairporttaxi.com/api/health   # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' https://ellicottcityairporttaxi.com/
```

### 3. Register the Actions runner

GitHub → repo `rominalimousineservice` → **Settings → Actions → Runners → New
self-hosted runner**. Copy the token it shows, then on the VPS:

```bash
sudo -u runner mkdir -p /home/runner/actions-runner-romina
cd /home/runner/actions-runner-romina
sudo -u runner cp /home/runner/actions-runner/config.sh .
sudo -u runner cp /home/runner/actions-runner/run.sh .
sudo -u runner ./config.sh --unattended --url https://github.com/quantumcoresoftwaredevloper-rgb/rominalimousineservice \
  --token <TOKEN> --name romina-vps --labels self-hosted,linux,romina --runasservice
```

A second runner instance is required — one machine can host several, but each is
registered to exactly one repo.

### 4. Repository secrets

For the workflow's build step:

| Secret | Value |
|---|---|
| `VITE_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` (publishable only — never the secret key) |
| `VITE_GOOGLE_CLIENT_ID` | the OAuth client id |

### 5. Google OAuth redirect

The OAuth client's authorized redirect URI must be
`https://rominalimousineservice.com/api/auth/google/callback`.

---

## Deploying

Push to `main`. `.github/workflows/deploy.yml` lints on `ubuntu-latest`, then
rsyncs both halves from the self-hosted runner.

Manual fallback, run from your Mac when the runner is down:

```bash
./scripts/deploy-interserver.sh
```

It builds locally, rsyncs over SSH, restarts `romina-api`, and prints both apps
from `pm2 list` so the other site is visible in the same output.

Both paths refuse to run against a box that does not have ellicott's directories,
and the workflow aborts unless the build actually produced an `index.html` —
`rsync --delete` on the wrong path is the one genuinely destructive operation in
the whole deployment.

---

## Verify

```bash
# this app
curl -s http://127.0.0.1:5002/api/health                     # {"status":"ok"}
curl -s -H "Host: rominalimousineservice.com" http://127.0.0.1/api/health
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: rominalimousineservice.com" http://127.0.0.1/fleet

# the other app, after every change
curl -s https://api.ellicottcityairporttaxi.com/api/health   # {"status":"ok"}
```

| Check | Expected |
|---|---|
| `/` and `/fleet` load | navy + gold site, phone `(240) 351-0826` |
| Refresh on `/fleet` | still renders — proves `try_files` fallback |
| Sign in as admin | works (same-origin, no CORS) |
| Book a ride → driver sees it | ~1 s via Socket.io |
| `pm2 list` | **both** `ellicott-api` and `romina-api` online |

---

## Rollback

```bash
# app only — previous build is gone (rsync --delete), so redeploy the last good commit
git revert <sha> && git push origin main

# or roll back by hand
cd /home/deploy/api-romina && pm2 restart romina-api

# if the database is implicated
mongodump --db ridetaxi --archive=/root/ridetaxi-$(date +\%F).gz --gzip
```

Backups are not configured yet. Add a cron job before this carries real data:

```
17 3 * * * mongodump --db ridetaxi --archive=/home/deploy/backups/ridetaxi-$(date +\%F).gz --gzip && find /home/deploy/backups -name '*.gz' -mtime +7 -delete
```

---

## Monitoring

The InterServer panel only reports box-level **Bandwidth/Traffic Usage** — it has
no per-application metric. Per-app numbers come from the box:

```bash
pm2 list          # per-app cpu% and memory, side by side
pm2 monit         # live graphs; ↑/↓ to switch apps
free -h           # mongod's cache is not a PM2 app and will not appear above
```

`mongod` currently holds a 2.39 GB cache (its 50% default on this box). Node is
capped at 350 MB via `max_memory_restart`. If the two apps ever fight for RAM,
lower Mongo's cache rather than Node's heap.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Deploy workflow never starts | Runner not registered for this repo — see step 3 |
| Workflow queued forever | Same. The existing runner is bound to the other repo |
| `502` on `/api` | `pm2 list` → `pm2 logs romina-api` → `curl 127.0.0.1:5002/api/health` |
| Live tracking stutters | `/socket.io/` block missing its `Upgrade`/`Connection` headers |
| Every deep link 404s | `try_files $uri $uri/ /index.html` missing from the vhost |
| Site 404 after deploy | `rsync --delete` removed a file; redeploy |
| **ellicottcityairporttaxi.com down** | Check `pm2 list` — a name collision would show one app missing. Names must stay `ellicott-api` / `romina-api` |
| Login works but socket events never arrive | Socket.io auth is JWT-only; a stale token in `localStorage` fails the handshake |

---

*Historical: `INTERSERVER_SIMPLE_GUIDE.md`, `INTERSERVER_DEPLOYMENT_GUIDE.md`,
`DEPLOYMENT_GUIDE.md` (Render + Vercel).*