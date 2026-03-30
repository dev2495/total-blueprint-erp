import os


if os.environ.get("ENABLE_CELERY_IMPORT") == "1" and os.environ.get("SKIP_CELERY_IMPORT") != "1":
    try:
        from .celery import app as celery_app
    except Exception:
        # The web app must stay bootable even when optional Celery metadata is unavailable.
        celery_app = None
else:
    celery_app = None

__all__ = ("celery_app",)
