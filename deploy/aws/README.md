# AWS Lightsail Production Runtime

This folder contains the pre-DNS AWS deployment scaffold for Total Poly Print ERP.

Runtime model:

- Host Caddy terminates public HTTP/HTTPS and proxies to local Docker ports.
- Docker Compose runs Postgres, Redis, Django/Gunicorn, Celery worker, Celery beat, and Next.js.
- Secrets live only on the server under `/opt/tpp-erp/secrets/app.env`.
- Persistent data lives under `/opt/tpp-erp/postgres`, `/opt/tpp-erp/redis`, `/opt/tpp-erp/media`, and `/opt/tpp-erp/backups`.
- Daily backups are written under `/opt/tpp-erp/backups/daily`.
- Managed encrypted backups are written under `/opt/tpp-erp/backups/managed`, and the weekly restore drill restores the latest one into an isolated temporary PostgreSQL database before dropping it.

Pre-DNS static-IP mode intentionally uses HTTP-compatible cookie settings. After DNS points to this server and Caddy issues TLS certificates, update the server env to:

- `SECURE_SSL_REDIRECT=True`
- `SESSION_COOKIE_SECURE=True`
- `CSRF_COOKIE_SECURE=True`
- `JWT_COOKIE_SECURE=True`
- `JWT_COOKIE_SAMESITE=None`
- `JWT_COOKIE_DOMAIN=.totalpolyprint.com`
- `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and `CSRF_TRUSTED_ORIGINS` set to the real domains.

For the initial Total Poly Print production subdomain, use `deploy/aws/Caddyfile.domain` and point `erp.totalpolyprint.com` to the Lightsail static IP.
