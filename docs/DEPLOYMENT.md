# Deployment

What-If runs as two containers: the app (Node.js, which serves both the API and the web UI) and PostgreSQL. Both containers are capped at 512 MB of memory by default. At idle the app uses about 80–120 MB.

## Example: a private Linux VM

These steps assume Debian or Ubuntu with Docker Engine and the Compose plugin installed, and the app living in `/opt/what-if`.

```bash
sudo mkdir -p /opt/what-if && sudo chown "$USER" /opt/what-if
```

```bash
git clone https://github.com/FouadHellal/What-If-.git /opt/what-if
```

```bash
cd /opt/what-if && cp .env.example .env && chmod 600 .env
```

Generate secrets and put them in `.env`:

```bash
sed -i "s|^APP_SECRET=.*|APP_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
```

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=\n')|" .env
```

Build and start:

```bash
docker compose up -d --build
```

```bash
docker compose ps
```

```bash
curl -s http://127.0.0.1:3000/api/health
```

The health check returns `{"status":"ok","database":"ok",…}`. Open the app and create the first account, which becomes the administrator. Once everyone who needs access has an account, close registration in **Settings → Instance**.

### Reaching it from other machines

By default the app binds to `127.0.0.1:3000`. Choose one of these options:

1. **Reverse proxy with HTTPS (recommended).** Use `deploy/Caddyfile.example` or `deploy/nginx.conf.example`, then set `PUBLIC_URL=https://your.host` and `TRUST_PROXY=true` in `.env` and run `docker compose up -d`. With an `https://` `PUBLIC_URL`, cookies are marked `Secure` and HSTS is sent.
2. **Private network only** (LAN or Tailscale) without TLS. Set `WHATIF_BIND=0.0.0.0` (or the VM's private IP) in `.env`. Sessions still work: cookies are not marked `Secure` unless `PUBLIC_URL` is `https://`. Use this only on networks you trust.

### Optional: local AI with Ollama on the same host

Run Ollama on the host. As an administrator, open **Settings → AI analyst** and choose *Ollama*, endpoint `http://host.docker.internal:11434`, and a model you have pulled (for example `llama3.1:8b`). Then enable the analyst. Nothing leaves the machine.

To make a provider the default for all users, set `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY` in `.env`. Each user must still switch the analyst on.

## Database migrations

Migrations run automatically at start-up (`MIGRATE_ON_START=true`) and are idempotent. To run them by hand:

```bash
docker compose run --rm app node dist/migrate.js
```

## Updating

```bash
cd /opt/what-if && ./deploy/backup.sh
```

```bash
git pull
```

```bash
docker compose up -d --build
```

```bash
docker compose logs -f app
```

The new container applies pending migrations before it starts serving. To roll back, check out the previous version, rebuild, and restore the backup you took before the update (migrations only move forward).

## Backups

`deploy/backup.sh` writes a compressed `pg_dump` to `./backups/` and keeps the 14 most recent.

```bash
./deploy/backup.sh
```

To run it daily at 03:15, run `crontab -e` and add:

```
15 3 * * * cd /opt/what-if && ./deploy/backup.sh >> backups/backup.log 2>&1
```

Copy `backups/` off the machine (rsync, restic, your NAS). Also back up `.env`: without the same `APP_SECRET`, stored AI keys cannot be decrypted. Everything else still works, and users just re-enter their keys.

## Restore

```bash
./deploy/restore.sh backups/what-if-20270101T031500Z.sql.gz
```

The script asks you to type `RESTORE`, stops the app, loads the dump, and starts the app again.

## Users can also export their own data

**Settings → Your data → Export** downloads a complete JSON export of one account. API keys and passwords are never included.

## Logs

The app writes structured JSON logs (pino) to stdout. Docker rotates them (10 MB × 5 files per container).

```bash
docker compose logs --since 1h app
```

Cookies, authorization headers and CSRF tokens are redacted from logs. Health checks are not logged.

## Resource notes

- Simulations are CPU-light: a 10-year scenario with 500 uncertainty runs takes 10–30 ms. No GPU is needed.
- PostgreSQL runs with `shared_buffers=128MB` and `max_connections=40`. The app pool uses at most 10 connections (`DATABASE_POOL_MAX`).
- The app container runs read-only, as a non-root user, with all capabilities dropped and `no-new-privileges` set.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `APP_SECRET is required in production` | Set `APP_SECRET` (≥ 32 characters) in `.env`. |
| App restarts with `Database not ready` | It retries for about 30 s. Check `docker compose logs db` and that `POSTGRES_PASSWORD` matches the one the volume was created with. Changing it later requires `ALTER USER` inside PostgreSQL. |
| Signed in but immediately signed out | You are using `https://` without `PUBLIC_URL`, or `COOKIE_SECURE=true` over plain HTTP. Align `PUBLIC_URL`/`COOKIE_SECURE` with how you reach the app. |
| “Missing request header” or “session token is out of date” | Reload the page. A proxy must pass the `X-Requested-With` and `X-CSRF-Token` headers through unchanged. |
| Wrong client IPs in the activity log | Set `TRUST_PROXY=true` behind a reverse proxy. |
| AI test fails with “Could not reach the AI provider” | Check the endpoint URL from inside the container: `docker compose exec app wget -qO- <url>`. For Ollama on the host, use `host.docker.internal`. |
| AI test fails with “rejected the credentials” | Re-enter the API key and check the model name. |
| PDF download fails | Check `docker compose logs app` for the error; reports with very long text are paginated automatically. |
| Port 3000 already in use | Set `WHATIF_PORT` in `.env`. |

## Without Docker

You need Node.js 22+ and PostgreSQL 14+.

```bash
npm ci && npm run build
```

```bash
NODE_ENV=production APP_SECRET=… DATABASE_URL=postgres://… WEB_DIST=apps/web/dist node apps/server/dist/index.js
```

Use a process manager (systemd) and a reverse proxy as above.
