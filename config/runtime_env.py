LOCAL_DEV_ENV_NAMES = {"development", "dev", "local"}
PRODUCTION_ENV_NAMES = {"production", "prod"}


def normalize_django_env(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    return normalized or "development"


def is_local_dev_env(value: str | None) -> bool:
    return normalize_django_env(value) in LOCAL_DEV_ENV_NAMES


def is_production_env(value: str | None) -> bool:
    return normalize_django_env(value) in PRODUCTION_ENV_NAMES


def is_hosted_secure_env(value: str | None) -> bool:
    return not is_local_dev_env(value)
