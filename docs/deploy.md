# PAMAA — Production Deployment Runbook

One Node process serves both the API (`/api/*`) and the built React client (`/`). One origin, one service, one env file. The host is not chosen yet; everything below works on any Docker host, VPS, or Node PaaS (Render, Railway, Fly, etc.).

```
Browser ──HTTPS──▶ host proxy / Caddy ──HTTP──▶ node server/src/index.js (:PORT) ──TLS──▶ MongoDB Atlas (M10, Mumbai)
                                                 ├─ /api/*   Express API
                                                 └─ /*       client/dist (SPA)
```

Order of work: **1. Atlas → 2. env vars → 3. deploy → 4. first run → 5. monitoring → 6. go-live checklist.**

---

## 1. MongoDB Atlas

1. **Project + cluster:** create a project `pamaa-prod` and a **dedicated M10 (or larger)** cluster in **AWS Mumbai (ap-south-1)** (or GCP/Azure Mumbai). Free/shared tiers (M0/Flex) are not used: orders, checkout and invoicing run in **multi-document transactions**, and we need continuous backup. Every Atlas cluster is a 3-node replica set, which transactions require.
2. **Database user (least privilege):** Database Access → Add user `pamaa_app`, password auth (generate a long random password), role **`readWrite` on database `pamaa` only** (Specific Privileges, not "Atlas admin" / "read and write to any database"). Create a separate human admin user for yourself; the app never uses it.
3. **Network access:** Network Access → add only the host's **static egress IP(s)**. **Never `0.0.0.0/0`.** If the chosen PaaS has no static egress IPs, either buy its static-IP add-on, use Atlas Private Endpoint / VPC peering, or choose a VPS. Add your office IP temporarily for the restore test and remove it afterwards.
4. **Connection string:** Connect → Drivers → copy the `mongodb+srv://` URI, put the db name in the path:
   `mongodb+srv://pamaa_app:<password>@<cluster>.mongodb.net/pamaa?retryWrites=true&w=majority` → `MONGODB_URI`. URL-encode special characters in the password.
5. **Backups:** Backup → enable **Cloud Backup** and **Continuous Cloud Backup (point-in-time restore)**; set the restore window (≥ 7 days; 30 is better for billing data). Keep the default daily/weekly/monthly snapshot policy.
6. **Test restore (go-live checklist item):**
   1. Create a throwaway M10 cluster `pamaa-restore-test` in the same project.
   2. Backup → `pamaa-prod` → **Restore** → Point in Time → pick a time ~10 minutes ago → target `pamaa-restore-test`.
   3. Connect with `mongosh` (temporary IP entry) and compare: `db.invoices.countDocuments()`, the latest `invoiceNumber`, `db.counters.find()`, `db.users.countDocuments()` must match production as of that time.
   4. Record the date, restore duration and result in the go-live checklist. **Terminate the test cluster** (it bills hourly).
7. **Alerts** (Project → Alerts → add, notify owner's email + phone/SMS):
   - Connections > 80% of the tier limit
   - Replication lag > 60 s / "no primary"
   - Disk space used > 80%
   - Host down / cluster unavailable
   - Backup failed / snapshot did not complete
   - (Optional) Query targeting: scanned/returned > 1000

## 2. Environment variables

Set these in the host's secret/env settings (or an `--env-file` on a VPS that only root can read). **Never commit them**; `.env*` is git- and docker-ignored.

| Variable | Required | Production value |
|---|---|---|
| `NODE_ENV` | yes | `production` (the Docker image sets it). Enables secure cookies, `trust proxy`, combined logs. |
| `PORT` | no | Port to listen on. Default `5050`. PaaS hosts inject their own — leave it to them. |
| `MONGODB_URI` | yes | Atlas URI from §1.4 (`pamaa_app` user, `/pamaa` db). |
| `JWT_SECRET` | yes | ≥ 32 chars, random. Access-token signing key. |
| `JWT_REFRESH_SECRET` | yes | ≥ 32 chars, random, **different** from `JWT_SECRET`. |
| `JWT_EXPIRES_IN` | no | Access-token lifetime. Default `15m`. |
| `CLIENT_URL` | yes | The public URL users open, e.g. `https://billing.pamaa.in` (no trailing slash). In single-service mode this is the app's own URL; it's the only origin CORS allows. |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | no | Image upload. Without them, upload returns 503 and admins paste image URLs. |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | first run only | Used once by `seed:admin` (§4), then **delete**. |
| `VITE_API_URL` | build-time, client | Leave unset (defaults to `/api`) in single-service mode. Only for the split option (§3c). |

Generate each secret:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Rotating `JWT_REFRESH_SECRET` logs everyone out (refresh tokens become invalid) — fine, but do it outside service hours.

## 3. Deploy options

All options need **HTTPS** in front: the refresh-token cookie is `Secure` in production, so login silently fails over plain HTTP.

### a) Docker (any host / VPS) — recommended

```sh
docker build -t pamaa:$(git rev-parse --short HEAD) .
docker run -d --name pamaa --restart unless-stopped \
  --env-file /etc/pamaa/prod.env -p 127.0.0.1:5050:5050 \
  pamaa:<tag>
```

The image is multi-stage `node:22-alpine`, runs as the non-root `node` user, has a `HEALTHCHECK` on `/api/health`, and contains no secrets. Keep every tag you deploy (push to a registry, or keep it locally) — it's your rollback.

HTTPS on a VPS with [Caddy](https://caddyserver.com) (auto Let's Encrypt), `/etc/caddy/Caddyfile`:

```
billing.pamaa.in {
    reverse_proxy 127.0.0.1:5050
}
```

Point the domain's A record at the VPS, open ports 80/443 only. On a container PaaS (Fly, Railway, Render "Docker" service, Cloud Run, …) just give it the Dockerfile; it provides HTTPS.

### b) Node PaaS without Docker (Render / Railway / Heroku-style)

- Node version: 22 (from `.nvmrc` / `engines`)
- Build command: `npm ci && npm run build`
- Start command: `npm start` (runs `node server/src/index.js`)
- Health check path: `/api/health`
- Env: §2. Set `NODE_ENV=production` explicitly (no Docker image to set it).

A plain VPS without Docker works the same way: `npm ci && npm run build && NODE_ENV=production pm2 start npm --name pamaa -- start`, behind Caddy.

### c) Split: static host for the client + separate API host (alternative)

Use only if there's a reason (e.g. a CDN-only static host). What changes:

- Build the client with `VITE_API_URL=https://api.example.com/api npm run build -w client`; deploy `client/dist` to the static host with an SPA rewrite (`/* → /index.html`) and long cache for `/assets/*`.
- API: `CLIENT_URL=https://app.example.com` (exact client origin — CORS only allows that, with credentials).
- Refresh cookie is then **cross-site**: it already uses `SameSite=None; Secure` in production, so **both** sites must be HTTPS. Browsers that block third-party cookies (Safari ITP, Chrome's phase-out) can break silent refresh unless both are on the same registrable domain (e.g. `app.pamaa.in` + `api.pamaa.in`, which is "same-site"). Prefer that, or prefer option (a)/(b).
- Two deploys to keep in sync on every release.

### Wiring note (code)

Single-service mode needs `serveClient(app)` from `server/src/static.js` mounted in `server/src/app.js` after the last `/api` route and before `notFound`. It's a no-op if `client/dist` doesn't exist (dev, tests, split mode).

## 4. First run

1. Deploy, then check `https://<domain>/api/health` → `{"success":true,"data":{"status":"ok"},…}` and `https://<domain>/` shows the login page.
2. Create the first admin **once** (with `MONGODB_URI` + `SEED_ADMIN_USERNAME` + `SEED_ADMIN_PASSWORD` set, ≥ 8 chars):
   - Node host: `npm run seed:admin` (in the host's shell / one-off job)
   - Docker: `docker run --rm --env-file /etc/pamaa/prod.env pamaa:<tag> node server/src/scripts/seed-admin.js`
   
   The script refuses to run if any admin exists, so it can't create a second one.
3. Log in as that admin and **change the password** immediately. Then **delete the `SEED_*` env vars** from the host.
4. Real data (S6-6): restaurant name/GSTIN/address, invoice start number, categories, menu, tables and staff — enter in the admin screens, or load the owner's setup file with `server/src/scripts/import-setup.js` (template: `docs/setup-template.json`; run with `--dry-run` first; field reference in `docs/admin-handover.md`). Verify **Settings → invoice start number** before the first real bill.
5. Print one test invoice on the restaurant's actual thermal printer.

**Time zone:** all timestamps are stored in UTC and shown in IST (Asia/Kolkata) by the app. Don't change the server/container TZ to "fix" times; it's not needed.

## 5. Monitoring

- **Uptime:** external HTTP check on `https://<domain>/api/health` every 1–5 min (UptimeRobot / Better Stack free tier, or the host's own), alert by SMS/email to the owner + developer. Docker also marks the container `unhealthy` via `HEALTHCHECK`.
- **Logs:** the app logs requests (combined format) and 5xx errors to stdout. Keep ≥ 14 days: the PaaS's log retention or a drain; on a VPS `docker run --log-opt max-size=10m --log-opt max-file=10` (or journald). Logs never contain passwords or tokens.
- **Atlas alerts:** §1.7.
- **Restart policy:** `--restart unless-stopped` (Docker) / pm2 / the PaaS restarts on crash. The process exits on bad env (fails fast at startup) — check logs first if it won't start.

## 6. Rollback plan

Releases are immutable: a Docker tag per commit (or a git commit for option b).

1. **App rollback (first choice, minutes):** redeploy the previous tag — `docker stop pamaa && docker rm pamaa && docker run … pamaa:<previous-tag>` — or on a PaaS click "rollback"/redeploy the previous commit. Phase 1 has no destructive migrations; the schema is backward-compatible across Phase 1 releases, so the old code runs against the current DB.
2. **Bad data (rare):** fix forward through the admin screens/void flows where possible (voids are audited).
3. **Last resort — Atlas PITR:** restore `pamaa-prod` to a point before the incident (§1.6 procedure, target = a new cluster, then switch `MONGODB_URI` and redeploy). Every bill/invoice after the restore point is lost and must be re-entered from paper — announce a short stop to staff, note the last invoice number first.
4. During go-live UAT the old billing system runs in parallel (S6-7), so it's the fallback for service continuity.

## 7. Go-live checklist

- [ ] All critical/high bugs closed
- [ ] Atlas M10 in Mumbai, `pamaa_app` user with `readWrite` on `pamaa` only, IP list = host egress IPs only (no `0.0.0.0/0`)
- [ ] Atlas continuous backup / PITR on; **backups verified with a test restore** (date: ____, result: ____)
- [ ] Atlas alerts configured (connections, replication lag, disk, backup)
- [ ] HTTPS working on the production domain; `CLIENT_URL` = that URL
- [ ] Uptime check on `/api/health` alerting
- [ ] Invoice counter starts at configured number
- [ ] Printer tested on the restaurant's actual thermal printer
- [ ] Admin password changed from seed; seed script disabled (`SEED_*` env vars removed; script refuses once an admin exists)
- [ ] Rollback plan agreed (previous tag/commit recorded: ____)
