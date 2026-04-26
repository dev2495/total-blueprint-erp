import logging

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated, PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


@api_view(['GET', 'HEAD'])
@permission_classes([AllowAny])
def health_live(request):
    """Liveness probe: process is alive and can serve requests."""
    payload = {
        "status": "ok",
        "service": "backend-api",
        "timestamp": timezone.now().isoformat(),
    }
    return JsonResponse(payload, status=200)


@api_view(['GET', 'HEAD'])
@permission_classes([AllowAny])
def health_ready(request):
    """Readiness probe: validates critical dependencies (DB, Redis, Celery)."""
    checks = {
        "database": {"ok": False},
        "redis": {"ok": False},
        "celery": {"ok": False},
    }

    # DB check
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        checks["database"] = {"ok": True}
    except Exception:
        checks["database"] = {"ok": False}

    # Redis check
    try:
        import redis  # type: ignore
        import os

        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        client = redis.Redis.from_url(redis_url, socket_timeout=2, socket_connect_timeout=2)
        checks["redis"] = {"ok": bool(client.ping())}
    except Exception:
        checks["redis"] = {"ok": False}

    # Celery check
    try:
        from config.celery import app as celery_app

        inspect = celery_app.control.inspect(timeout=2)
        workers = inspect.stats() or {}
        checks["celery"] = {"ok": bool(workers), "workers": len(workers)}
    except Exception:
        checks["celery"] = {"ok": False}

    required_checks = {"database", "redis"}
    if getattr(settings, "IS_PRODUCTION", False):
        required_checks.add("celery")
    ok = all(checks[name].get("ok") for name in required_checks)
    payload = {
        "status": "ready" if ok else "degraded",
        "timestamp": timezone.now().isoformat(),
        "checks": checks,
        "required_checks": sorted(required_checks),
    }
    return JsonResponse(payload, status=200 if ok else 503)


# Backward compatibility endpoint.
@api_view(['GET', 'HEAD'])
@permission_classes([AllowAny])
def health_check(request):
    payload = {
        "status": "ok",
        "service": "backend-api",
        "timestamp": timezone.now().isoformat(),
    }
    return JsonResponse(payload, status=200)


def custom_exception_handler(exc, context):
    """
    Stable global exception handler.
    Keeps truthful HTTP status codes while normalizing error payloads.
    """
    response = exception_handler(exc, context)
    request = context.get("request")

    if isinstance(exc, (NotAuthenticated, AuthenticationFailed, PermissionDenied)):
        logger.info("Auth/permission exception intercepted: %s", str(exc))
    elif response is not None and response.status_code < 500:
        logger.warning("Client exception intercepted: %s", str(exc), exc_info=True)
    else:
        logger.error("Global exception intercepted: %s", str(exc), exc_info=True)

    def _status_to_code(status_code: int) -> str:
        if isinstance(exc, NotAuthenticated):
            return "AUTH_REQUIRED"
        if isinstance(exc, AuthenticationFailed):
            return "AUTH_FAILED"
        if isinstance(exc, PermissionDenied):
            return "FORBIDDEN"
        if status_code == status.HTTP_400_BAD_REQUEST:
            return "BAD_REQUEST"
        if status_code == status.HTTP_401_UNAUTHORIZED:
            return "UNAUTHORIZED"
        if status_code == status.HTTP_403_FORBIDDEN:
            return "FORBIDDEN"
        if status_code == status.HTTP_404_NOT_FOUND:
            return "NOT_FOUND"
        if status_code == status.HTTP_429_TOO_MANY_REQUESTS:
            return "RATE_LIMITED"
        if status_code >= 500:
            return "INTERNAL_ERROR"
        return "REQUEST_FAILED"

    request_id = str(getattr(request, "request_id", "") or "")

    if response is None:
        error_code = "INTERNAL_ERROR"
        message = "Internal server error."
        data = {
            "status": "error",
            "code": error_code,
            "message": message,
            "detail": message,
            "results": [],
            "data": {},
            "count": 0,
        }
        if request_id:
            data["request_id"] = request_id
        return Response(data, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    detail = response.data
    if isinstance(detail, dict):
        if "detail" in detail:
            normalized_detail = detail.get("detail")
        elif "error" in detail:
            normalized_detail = detail.get("error")
        elif "message" in detail:
            normalized_detail = detail.get("message")
        else:
            normalized_detail = detail
    else:
        normalized_detail = detail

    status_code = int(response.status_code)
    error_code = _status_to_code(status_code)
    message = "Request failed."
    if error_code == "AUTH_REQUIRED":
        message = "Authentication is required."
    elif error_code == "AUTH_FAILED":
        message = "Authentication failed."
    elif error_code == "FORBIDDEN":
        message = "You do not have permission to perform this action."
    elif error_code == "RATE_LIMITED":
        message = "Rate limit exceeded."
    elif error_code == "INTERNAL_ERROR":
        message = "Internal server error."

    safe_detail = normalized_detail if status_code < 500 else message
    response.data = {
        "status": "error",
        "code": error_code,
        "message": message,
        "detail": safe_detail,
        "results": [],
        "data": {},
        "count": 0,
    }
    if request_id:
        response.data["request_id"] = request_id
    return response
