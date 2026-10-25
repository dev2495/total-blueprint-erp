"""Django settings for total blueprint ERP."""

import importlib.util
import logging
import os
import socket
import sys
from datetime import timedelta
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured

from dotenv import load_dotenv
from config.runtime_env import (
    is_hosted_secure_env,
    is_local_dev_env,
    is_production_env,
    normalize_django_env,
)

logger = logging.getLogger(__name__)

COMMAND_LINE = " ".join(sys.argv).lower()
IS_CELERY_PROCESS = "celery" in COMMAND_LINE

if (not IS_CELERY_PROCESS) and (
    os.getenv("ENABLE_CELERY_IMPORT") != "1" or os.getenv("SKIP_CELERY_IMPORT") == "1"
):
    # Lightweight Django bootstrap paths do not need live Celery schedule objects.
    def crontab(*args, **kwargs):
        return {"args": args, "kwargs": kwargs}
else:
    try:
        from celery.schedules import crontab
    except Exception:
        def crontab(*args, **kwargs):
            return {"args": args, "kwargs": kwargs}

# Load environment variables
if os.environ.get("SKIP_DOTENV_IMPORT") != "1":
    load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
HAS_WHITENOISE = bool(importlib.util.find_spec("whitenoise"))


# Small env helper for explicit boolean controls.
def _env_bool(name: str, default: bool) -> bool:
    raw = str(os.getenv(name, str(default))).strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def _detect_primary_ipv4() -> str:
    """Best-effort LAN IPv4 detection for local CSRF/CORS ergonomics."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = str(s.getsockname()[0] or "").strip()
            if ip and ":" not in ip:
                return ip
    except Exception:
        return ""
    return ""


def _detect_local_ipv4s() -> list[str]:
    candidates: set[str] = set()
    primary = _detect_primary_ipv4()
    if primary:
        candidates.add(primary)

    try:
        for _, _, _, _, sockaddr in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = str((sockaddr or [""])[0] or "").strip()
            if ip and ":" not in ip:
                candidates.add(ip)
    except Exception:
        logger.debug("Unable to discover local IPv4 addresses via getaddrinfo", exc_info=True)

    try:
        _, _, host_ips = socket.gethostbyname_ex(socket.gethostname())
        for ip in host_ips:
            token = str(ip or "").strip()
            if token and ":" not in token:
                candidates.add(token)
    except Exception:
        logger.debug("Unable to discover local IPv4 addresses via hostname lookup", exc_info=True)

    return sorted(candidates)


# Environment and runtime mode
DJANGO_ENV = normalize_django_env(os.getenv("DJANGO_ENV", "development"))
IS_LOCAL_DEV = is_local_dev_env(DJANGO_ENV)
IS_PRODUCTION = is_production_env(DJANGO_ENV)
IS_HOSTED_SECURE = is_hosted_secure_env(DJANGO_ENV)

IS_HTTP_PROCESS = (not IS_CELERY_PROCESS) and any(
    token in COMMAND_LINE for token in ("gunicorn", "runserver", "uvicorn", "daphne")
)

SECRET_KEY = os.getenv("SECRET_KEY", "django-insecure-fallback")
DEBUG = os.getenv("DEBUG", "False") == "True"
if IS_PRODUCTION:
    DEBUG = False

# v3 Product Master sales model rollout guard. Default is on locally/currently,
# but this gives us a single backend switch to fail closed if rollout needs pause.
ERP_V3_DEFAULT = _env_bool("ERP_V3_DEFAULT", True)

_raw_allowed_hosts = os.getenv("ALLOWED_HOSTS", "").strip()
if IS_HOSTED_SECURE:
    ALLOWED_HOSTS = [host.strip() for host in _raw_allowed_hosts.split(",") if host.strip()]
else:
    # Dev/LAN default: always allow host headers from same-network devices.
    parsed_hosts = [host.strip() for host in _raw_allowed_hosts.split(",") if host.strip()]
    if "*" not in parsed_hosts:
        parsed_hosts.append("*")
    ALLOWED_HOSTS = parsed_hosts


INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "django_filters",
    "corsheaders",
    "apps.materials",
    "apps.recipes",
    "apps.factory",
    "apps.routing",
    "apps.templates",
    "apps.sales",
    "apps.inventory.apps.InventoryConfig",
    "apps.production",
    "apps.physics",
    "apps.bom",
    "apps.users",
    "apps.tooling",
    "apps.artwork",
    "apps.dashboard",
    "apps.analytics",
    "apps.mrp",
    "apps.costing",
    "apps.procurement",
    "apps.platformops",
    "apps.gate.apps.GateConfig",
    "apps.maintenance.apps.MaintenanceConfig",
    "rest_framework_simplejwt.token_blacklist",
]
if not _env_bool("SKIP_ADMIN_APP_IMPORT", False):
    INSTALLED_APPS.insert(0, "django.contrib.admin")

# CORS hardening
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "x-role-override",
    "x-request-id",
    "idempotency-key",
]
CORS_EXPOSE_HEADERS = ["x-role-override", "x-request-id"]

if IS_HOSTED_SECURE:
    CORS_ALLOW_ALL_ORIGINS = False
    CORS_ALLOWED_ORIGINS = [
        origin.strip()
        for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    ]
else:
    CORS_ALLOW_ALL_ORIGINS = True
    CORS_ALLOWED_ORIGINS = []


AUTH_USER_MODEL = "users.User"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.users.authentication.CookieJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
        "apps.users.permissions.RoleBasedAccessPermission",
    ),
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": os.getenv("DRF_THROTTLE_ANON", "120/min"),
        "user": os.getenv("DRF_THROTTLE_USER", "600/min"),
        "auth": os.getenv("DRF_THROTTLE_AUTH", "200/min"),
    },
    "EXCEPTION_HANDLER": "config.views.custom_exception_handler",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("JWT_ACCESS_MINUTES", "20"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("JWT_REFRESH_MINUTES", "20"))),
    "ROTATE_REFRESH_TOKENS": _env_bool("JWT_ROTATE_REFRESH_TOKENS", True),
    "BLACKLIST_AFTER_ROTATION": True,
}

JWT_ACCESS_COOKIE_NAME = os.getenv("JWT_ACCESS_COOKIE_NAME", "access")
JWT_REFRESH_COOKIE_NAME = os.getenv("JWT_REFRESH_COOKIE_NAME", "refresh")
JWT_ACCESS_COOKIE_PATH = os.getenv("JWT_ACCESS_COOKIE_PATH", "/")
JWT_REFRESH_COOKIE_PATH = os.getenv("JWT_REFRESH_COOKIE_PATH", "/api/users/token/refresh/")
JWT_COOKIE_SECURE = _env_bool("JWT_COOKIE_SECURE", IS_HOSTED_SECURE)
# The browser reaches the UI and the API on one origin (Caddy proxies /api),
# so session cookies never need to travel on cross-site requests.
JWT_COOKIE_SAMESITE = os.getenv("JWT_COOKIE_SAMESITE", "Lax")
JWT_COOKIE_DOMAIN = os.getenv("JWT_COOKIE_DOMAIN", "").strip() or None
# Domains auth cookies were previously issued for (e.g. ".example.com"). Their
# cookies are expired on every sign-in, refresh and logout after the move to
# host-only cookies, so a stale parent-domain cookie can never linger.
JWT_LEGACY_COOKIE_DOMAINS = [
    value.strip() for value in os.getenv("JWT_LEGACY_COOKIE_DOMAINS", "").split(",") if value.strip()
]
JWT_COOKIE_HTTPONLY = True

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # Caddy compresses responses in production; compressing again in Python only costs CPU.
    *([] if IS_PRODUCTION else ["django.middleware.gzip.GZipMiddleware"]),
    "django.contrib.sessions.middleware.SessionMiddleware",
    # Accept both `/api/x` and `/api/x/` without redirects.
    "config.api_slash_middleware.ApiSlashCompatMiddleware",
    "django.middleware.common.CommonMiddleware",
    "config.head_response_middleware.HeadResponseCleanupMiddleware",
    "config.local_dev_csrf.LocalDevCsrfViewMiddleware" if IS_LOCAL_DEV else "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.users.middleware.RoleOverrideMiddleware",
    "config.request_context_middleware.RequestContextMiddleware",
    # Writes queued permission-audit rows after the request transaction ends.
    "apps.users.audit_outbox.DeferredAuditMiddleware",
]
if HAS_WHITENOISE:
    MIDDLEWARE.insert(2, "whitenoise.middleware.WhiteNoiseMiddleware")

APPEND_SLASH = False
ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"


DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME", "total_blueprint_erp"),
        "USER": os.getenv("DB_USER", "blueprint_admin"),
        "PASSWORD": os.getenv("DB_PASSWORD", ""),
        "HOST": os.getenv("DB_HOST", "localhost"),
        "PORT": os.getenv("DB_PORT", "5432"),
        "CONN_MAX_AGE": int(os.getenv("DB_CONN_MAX_AGE", "60")),
        "ATOMIC_REQUESTS": True,
    }
}


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


LANGUAGE_CODE = "en-us"
TIME_ZONE = os.getenv("TIME_ZONE", "UTC")
GATE_TIME_ZONE = os.getenv("GATE_TIME_ZONE", "Asia/Kolkata")
GATE_TRUSTED_PROXY_IPS = [value.strip() for value in os.getenv("GATE_TRUSTED_PROXY_IPS", "").split(",") if value.strip()]
USE_I18N = False
USE_TZ = True


STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = os.getenv("MEDIA_URL", "/media/")
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT") or (BASE_DIR / "media"))
PUBLIC_BACKEND_URL = os.getenv("PUBLIC_BACKEND_URL", "").strip().rstrip("/")
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
        if HAS_WHITENOISE
        else "django.contrib.staticfiles.storage.StaticFilesStorage"
    },
}


# Hosted security hardening
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = os.getenv("SECURE_SSL_REDIRECT", "True" if IS_HOSTED_SECURE else "False") == "True"
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "True" if IS_HOSTED_SECURE else "False") == "True"
CSRF_COOKIE_SECURE = os.getenv("CSRF_COOKIE_SECURE", "True" if IS_HOSTED_SECURE else "False") == "True"
SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "31536000" if IS_PRODUCTION else "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = os.getenv("SECURE_HSTS_INCLUDE_SUBDOMAINS", "True" if IS_PRODUCTION else "False") == "True"
SECURE_HSTS_PRELOAD = os.getenv("SECURE_HSTS_PRELOAD", "True" if IS_PRODUCTION else "False") == "True"
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
_csrf_trusted_origins = {
    origin.strip() for origin in os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",") if origin.strip()
}
if IS_LOCAL_DEV:
    dev_hosts = {
        "localhost",
        "127.0.0.1",
        str(os.getenv("DEV_HOST_IP", "")).strip(),
        _detect_primary_ipv4(),
    }
    dev_hosts.update(_detect_local_ipv4s())
    dev_hosts.update({host for host in ALLOWED_HOSTS if host and host != "*"})
    dev_hosts.update(
        host.strip()
        for host in str(os.getenv("DEV_TRUSTED_HOSTS", "")).split(",")
        if host.strip()
    )
    for host in dev_hosts:
        if not host:
            continue
        for scheme in ("http", "https"):
            for port in ("3000", "3001", "8000"):
                _csrf_trusted_origins.add(f"{scheme}://{host}:{port}")
CSRF_TRUSTED_ORIGINS = sorted(_csrf_trusted_origins)


# RBAC controls
STRICT_RBAC = os.getenv("STRICT_RBAC", "False" if IS_LOCAL_DEV else "True") == "True"
ALLOW_ROLE_OVERRIDE = os.getenv("ALLOW_ROLE_OVERRIDE", "True" if IS_LOCAL_DEV else "False") == "True"
if IS_HOSTED_SECURE and ALLOW_ROLE_OVERRIDE:
    raise ImproperlyConfigured("ALLOW_ROLE_OVERRIDE must be False in hosted environments.")


# Celery / Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


def _redis_db_url(url: str, db: int) -> str:
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{db}", parts.query, parts.fragment))


# Shared cache for rate limits, sign-in lockouts and short-lived dashboard
# caches. Hosted environments share it across workers through Redis (a
# separate database from the Celery broker); local development and tests use
# an in-process cache unless CACHE_BACKEND=redis is set.
_cache_backend = os.getenv("CACHE_BACKEND", "redis" if IS_HOSTED_SECURE else "locmem").strip().lower()
if _cache_backend == "redis":
    CACHES = {
        "default": {
            "BACKEND": "config.cache_backends.ResilientRedisCache",
            "LOCATION": os.getenv("CACHE_REDIS_URL", "").strip() or _redis_db_url(REDIS_URL, 1),
            "KEY_PREFIX": "tpp-erp",
            "TIMEOUT": 300,
            "OPTIONS": {"socket_connect_timeout": 1, "socket_timeout": 1},
        }
    }
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "tpp-erp"}}
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", REDIS_URL)
CELERY_RESULT_EXPIRES = int(os.getenv("CELERY_RESULT_EXPIRES", "3600"))
CELERY_TASK_ALWAYS_EAGER = os.getenv("CELERY_TASK_ALWAYS_EAGER", "False") == "True"
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = int(os.getenv("CELERY_TASK_TIME_LIMIT", "900"))
CELERY_TASK_SOFT_TIME_LIMIT = int(os.getenv("CELERY_TASK_SOFT_TIME_LIMIT", "840"))
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
# Beat schedules below are factory local time (IST), not UTC.
CELERY_TIMEZONE = os.getenv("CELERY_TIMEZONE", "Asia/Kolkata")
CELERY_ENABLE_UTC = True
# Add-on (tape, zipper) shortages at a step: shown and flagged always; they block
# WCM release and machine start only when this is on. Turn on once add-on stock
# is received into the ERP at the plant.
ADDON_SHORTAGE_BLOCKS = os.getenv("ADDON_SHORTAGE_BLOCKS", "False").strip().lower() in {"1", "true", "yes"}
# Floor roll picker: a roll within this many mm of the planned web (either side) is used as it is.
ROLL_PICK_WIDTH_TOLERANCE_MM = float(os.getenv("ROLL_PICK_WIDTH_TOLERANCE_MM", "20") or 20)
# Packing yard check limits (percent). Within both, a closed batch is verified; outside,
# it is held for dispatch until a supervisor accepts it with a reason.
PACKING_VERIFY_PCS_PCT = float(os.getenv("PACKING_VERIFY_PCS_PCT", "2") or 2)
PACKING_VERIFY_KG_PCT = float(os.getenv("PACKING_VERIFY_KG_PCT", "2") or 2)
# Only batches made from this moment go through the packing check; older batches keep working
# as before and are never closed or booked by it. Blank = when the packing check went live
# (its migration was applied). Accepts YYYY-MM-DD or an ISO date-time in plant time.
PACKING_VERIFY_START_DATE = os.getenv("PACKING_VERIFY_START_DATE", "").strip()
# Base rule: only inner pouches are consumed automatically; gonnies are marked and taken off
# stock by the evening packing count. Set to true only to go back to consuming a gonny on creation.
PACKING_GONNY_AUTO_CONSUME = os.getenv("PACKING_GONNY_AUTO_CONSUME", "false").strip().lower() in {"1", "true", "yes", "on"}

CELERY_BEAT_SCHEDULE = {
    "maintenance-due-jobs-daily": {
        "task": "apps.maintenance.tasks.generate_due_maintenance_jobs",
        "schedule": crontab(minute=30, hour=5),  # 05:30 IST, before the day shift
    },
    "maintenance-overdue-reminder": {
        "task": "apps.maintenance.tasks.notify_overdue_maintenance",
        "schedule": crontab(minute=0, hour=8),  # 08:00 IST
    },
    "db-backup-every-4h": {
        "task": "apps.platformops.tasks.run_db_backup_task",
        "schedule": crontab(minute=0, hour="*/4"),
    },
    "backup-retention-daily": {
        "task": "apps.platformops.tasks.prune_backup_retention_task",
        "schedule": crontab(minute=20, hour=1),  # 01:20 IST
    },
    "restore-drill-weekly": {
        "task": "apps.platformops.tasks.run_restore_drill_task",
        "schedule": crontab(minute=45, hour=2, day_of_week="sun"),  # Sunday 02:45 IST
    },
    "inventory-snapshot-nightly": {
        "task": "apps.platformops.tasks.run_inventory_snapshot_task",
        # End of the business day, so each daily snapshot is that day's close.
        "schedule": crontab(minute=45, hour=23),  # 23:45 IST
    },
    "queue-health-monitor": {
        "task": "apps.platformops.tasks.monitor_queue_health_task",
        "schedule": crontab(minute="*/5"),
    },
    "daily-report-pack-dispatch-check": {
        "task": "apps.analytics.tasks.dispatch_due_report_packs_task",
        "schedule": crontab(minute="*"),
    },
    # Sprint 3 — Reorder policy + nightly MRP.
    "low-stock-scan": {
        "task": "apps.inventory.tasks.low_stock_scan",
        "schedule": crontab(minute=0, hour=6),  # 06:00 IST, before the day shift
    },
    "mrp-nightly": {
        "task": "apps.mrp.tasks.run_nightly_mrp",
        "schedule": crontab(minute=0, hour=2),  # 02:00 IST
    },
    # Bills & documents, gate passes and job work reminders (IST mornings,
    # unchanged from their previous 03:30-03:50 UTC run times).
    "document-reminders-daily": {
        "task": "apps.gate.tasks.document_reminders_task",
        "schedule": crontab(minute=0, hour=9),  # 09:00 IST
    },
    "gate-pass-overdue-daily": {
        "task": "apps.gate.tasks.gate_pass_overdue_task",
        "schedule": crontab(minute=5, hour=9),  # 09:05 IST
    },
    "jobwork-overdue-daily": {
        "task": "apps.inventory.tasks.jobwork_overdue_task",
        "schedule": crontab(minute=10, hour=9),  # 09:10 IST
    },
    "document-storage-monitor-daily": {
        "task": "apps.gate.tasks.document_storage_monitor_task",
        "schedule": crontab(minute=20, hour=9),  # 09:20 IST
    },
}


# Structured logging
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "config.logging_formatters.JsonFormatter",
        },
        "simple": {
            "format": "%(levelname)s %(name)s %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json" if IS_PRODUCTION else "simple",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": os.getenv("LOG_LEVEL", "INFO"),
    },
}


# Optional Sentry integration
SENTRY_DSN = os.getenv("SENTRY_DSN", "").strip()
if SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.django import DjangoIntegration

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=DJANGO_ENV,
            integrations=[DjangoIntegration()],
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            send_default_pii=False,
        )
    except Exception:
        # Never break app startup on observability bootstrap failure.
        logger.warning("Sentry observability bootstrap failed; continuing without Sentry", exc_info=True)


# Fail-closed security posture in hosted environments.
if IS_HOSTED_SECURE:
    missing = []
    if not SECRET_KEY or SECRET_KEY == "django-insecure-fallback":
        missing.append("SECRET_KEY")
    if IS_HTTP_PROCESS:
        if not ALLOWED_HOSTS:
            missing.append("ALLOWED_HOSTS")
        elif "*" in ALLOWED_HOSTS:
            missing.append("ALLOWED_HOSTS must not contain '*' in hosted environments")
        if not CORS_ALLOWED_ORIGINS:
            missing.append("CORS_ALLOWED_ORIGINS")
        if CORS_ALLOW_ALL_ORIGINS:
            missing.append("CORS_ALLOW_ALL_ORIGINS must be False in hosted environments")
        if not CSRF_TRUSTED_ORIGINS:
            missing.append("CSRF_TRUSTED_ORIGINS")
    if not os.getenv("DB_PASSWORD", "").strip():
        missing.append("DB_PASSWORD")
    if JWT_COOKIE_SAMESITE.lower() == "none" and not JWT_COOKIE_SECURE:
        missing.append("JWT_COOKIE_SECURE=True (required when JWT_COOKIE_SAMESITE=None)")
    if missing:
        raise ImproperlyConfigured(
            "Missing/invalid production security settings: " + ", ".join(missing)
        )
