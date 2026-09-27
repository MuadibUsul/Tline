# Production deployment

The production topology is **Docker Compose → shared Caddy**, with the image built **on this
host** and no registry in the loop. The application does not publish a host port; Caddy is the
only thing listening on 80/443, and it proxies the container by name (`tline-app:3000`).

> The image name still reads `ghcr.io/muadibusul/tline`, and nothing pushes to or pulls from
> GHCR. That is deliberate, not an oversight. Releases used to build a 4.8 GB image on a hosted
> runner, push it, and pull it back onto this host; that is what exhausted the account's Actions
> minutes and stopped deploys. See the header of `.github/workflows/deploy.yml` for the full
> account. The cost of building locally is that the image has no off-host copy — rollback relies
> on the last three tags being kept on this machine.

## One-time setup

1. Review and run `bootstrap-vps.sh` as root on a fresh Debian/Ubuntu host. Copy the deploy user's authorized SSH key before ending the root session, and verify a second SSH login before closing the first.
2. Copy `proxy/` to `/home/deploy/proxy`, rename `Caddyfile.example` to `Caddyfile`, replace the hostname, and run `docker compose up -d` there.
3. Create `/home/deploy/tline/.env` with mode `600`. Use the variables in `.env.example`; production requires PostgreSQL, HTTPS `SITE_URL`, `AUTH_PROVIDER=email`, `EMAIL_SERVER`, `EMAIL_FROM`, `HEALTH_DETAIL_TOKEN`, and strong auth/health secrets. `npm run env:check:production` runs at container start and fails it if any of them is missing or weak.
4. For Resend use `smtp://resend:<API_KEY>@smtp.resend.com:587`, verify the sender domain, and publish the SPF/DKIM records Resend provides.
5. Install a self-hosted Actions runner on this host carrying the `tline` label, as an unprivileged user in the `docker` group (root-equivalent — see the note in `DEPLOYMENT.md`). Every workflow targets `runs-on: [self-hosted, tline]`; there is no SSH path and no hosted runner.
6. Add the repository secret `JEV_API_KEY` if the typed-decision provider is enabled. It is the only secret any workflow reads, and each release rewrites it into `/home/deploy/tline/.env`. Protect the `production` GitHub environment if manual approval is desired.

There is no `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` to configure: those belonged to the
registry-and-SSH pipeline that was replaced.

## First deployment

Create the external network, build the image the prod compose expects, then start the stack:

```sh
docker network inspect web >/dev/null 2>&1 || docker network create web
docker build -t ghcr.io/muadibusul/tline:latest .
TAG=latest docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app npm run db:seed
```

`docker-compose.prod.yml` sets `image:` per service and `build: !reset null`, so on this host
Compose uses the tag you just built instead of building again. After that, pushing to `main`
builds and ships a `sha-<12>` tag automatically. Do not run `compose pull` — there is nothing to
pull.

Verify `/api/health`, security headers, `robots.txt`, `sitemap.xml`, a real Resend magic-link delivery, and `docker stats`. The Actions workflow stores the last healthy immutable image tag in `.deploy-tag` and rolls back to it after a failed health gate.

Install `tline-backup.cron.example` only after a manual backup and restore verification. Its snapshots remain on the same VPS; add an offsite object-storage sync before treating them as disaster recovery.
