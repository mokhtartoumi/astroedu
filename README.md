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

## Deploy on Fly.io
    fly auth login
    # edit app name in fly.toml, then:
    fly launch --no-deploy --copy-config
    fly volumes create astro_data --size 1 --region cdg
    fly secrets set ADMIN_PASSWORD="your-strong-password"
    fly deploy
    fly scale count 1        # a volume is tied to one machine
    fly open                 # then add /#admin
Backup: `fly ssh sftp get /data/astroverse.db`. Fly also takes automatic volume snapshots.

## FREE deployment (no bank card): Render + Upstash Redis
Render hosts the app (free web service). Upstash Redis stores the data (free database), so nothing is lost when Render restarts or sleeps.
1. Upstash: create a free account, create a Redis database, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (REST API section).
2. GitHub: create a free repo and upload the project files (not the `data` folder).
3. Render: New > Web Service > connect the repo. Runtime Node, Build command `echo ok`, Start command `node server.js`, Instance type Free.
4. Environment variables: `ADMIN_PASSWORD`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
5. Open `https://<name>.onrender.com/#admin`.
The free service sleeps after ~15 min without visits (first load can take 30-60 s). Uploaded 3D models (.glb, max 6 MB each) and all content count toward Upstash's free 256 MB.
To grow later: upgrade the Render instance (paid, no sleeping) and/or Upstash pay-as-you-go. No code change needed.
