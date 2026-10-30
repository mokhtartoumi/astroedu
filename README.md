# ASTROVERSE

Zero-dependency Node.js app: front-end + REST API + SQLite database. Needs Node 22.13+ (or Docker).

## Run locally
    ADMIN_PASSWORD=MySecret123 npm start        # http://localhost:3000
Admin panel: open `/#admin` and log in. Every edit is saved to `data/astroverse.db` automatically.

## Deploy (Docker, any VPS / Railway / Fly.io / Render)
    docker compose up -d --build
Mount a persistent volume on `/data` (docker-compose.yml already does). On Railway, Fly.io or Render add a volume mounted at `/data` and set `ADMIN_PASSWORD` (used on first start only; change it later in the admin panel, Site tab).
Put it behind HTTPS (Caddy, Nginx, or the platform's TLS).

## Backups
Everything lives in `/data/astroverse.db`. Copy that file regularly (e.g. cron). The server also keeps the last 30 versions of the content: `GET /api/stats` lists them, `POST /api/restore {"id":N}` restores one (send header `Authorization: Bearer <token>`).

## Not included yet
ZIP project upload, multi-user accounts, server-side file uploads (images are stored inside the database), eclipse simulator, planet textures.
