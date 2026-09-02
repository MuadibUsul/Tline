# Production deployment

The production topology is GHCR → Docker Compose → shared Caddy. The application does not publish a host port.

## One-time setup

1. Review and run `bootstrap-vps.sh` as root on a fresh Debian/Ubuntu host. Copy the deploy user's authorized SSH key before ending the root session, and verify a second SSH login before closing the first.
2. Copy `proxy/` to `/home/deploy/proxy`, rename `Caddyfile.example` to `Caddyfile`, replace the hostname, and run `docker compose up -d` there.
3. Create `/home/deploy/tline/.env` with mode `600`. Use the variables in `.env.example`; production requires PostgreSQL, HTTPS `SITE_URL`, `AUTH_PROVIDER=email`, `EMAIL_SERVER`, `EMAIL_FROM`, and strong auth/health secrets.
4. For Resend use `smtp://resend:<API_KEY>@smtp.resend.com:587`, verify the sender domain, and publish the SPF/DKIM records Resend provides.
5. Log in to GHCR once on the VPS with a read-only package token.
6. Add repository secrets `VPS_HOST`, `VPS_USER`, and `VPS_SSH_KEY`. Protect the `production` GitHub environment if manual approval is desired.

## First deployment

Create the external network and start the stack once before enabling Actions:

```sh
docker network inspect web >/dev/null 2>&1 || docker network create web
TAG=latest docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
TAG=latest docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app npm run db:seed
```

Verify `/api/health`, security headers, `robots.txt`, `sitemap.xml`, a real Resend magic-link delivery, and `docker stats`. The Actions workflow stores the last healthy immutable image tag in `.deploy-tag` and rolls back to it after a failed health gate.

Install `tline-backup.cron.example` only after a manual backup and restore verification. Its snapshots remain on the same VPS; add an offsite object-storage sync before treating them as disaster recovery.
