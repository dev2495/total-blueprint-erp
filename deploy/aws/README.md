# AWS Lightsail Production Runtime

This folder contains the pre-DNS AWS deployment scaffold for Total Poly Print ERP.

Runtime model:

- Host Caddy terminates public HTTP/HTTPS and proxies to local Docker ports.
- Docker Compose runs Postgres, Redis, Django/Gunicorn, Celery worker, Celery beat, and Next.js.
- Secrets live only on the server under `/opt/tpp-erp/secrets/app.env`.
- Persistent data lives under `/opt/tpp-erp/postgres`, `/opt/tpp-erp/redis`, and `/opt/tpp-erp/media`.
- Daily backups are written under `/opt/tpp-erp/backups/daily`.

Pre-DNS static-IP mode intentionally uses HTTP-compatible cookie settings. After DNS points to this server and Caddy issues TLS certificates, update the server env to:

- `SECURE_SSL_REDIRECT=True`
- `SESSION_COOKIE_SECURE=True`
- `CSRF_COOKIE_SECURE=True`
- `JWT_COOKIE_SECURE=True`
- `JWT_COOKIE_SAMESITE=None`
- `JWT_COOKIE_DOMAIN=.totalpolyprint.com`
- `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and `CSRF_TRUSTED_ORIGINS` set to the real domains.
