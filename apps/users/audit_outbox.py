"""Permission-audit rows that must survive a rolled-back request.

Every API request runs inside one database transaction (ATOMIC_REQUESTS), and
a refused or failed mutation rolls that transaction back so it can never
commit a partial change. Evidence of the refusal itself (an RBAC denial, a
rejected assignment) must still be recorded, so it is queued on the request
and written by ``DeferredAuditMiddleware`` after the request transaction has
ended. Outside a request served through the middleware (management commands,
direct permission checks in tests) the row is written immediately.
"""
import logging

from django.db import transaction

logger = logging.getLogger(__name__)

OUTBOX_ATTR = "_deferred_permission_audits"


def _http_request(request):
    return getattr(request, "_request", request)


def record_permission_audit(request=None, **fields):
    """Queue a PermissionAuditLog row for after the request, or write it now."""
    target = _http_request(request) if request is not None else None
    pending = getattr(target, OUTBOX_ATTR, None) if target is not None else None
    if isinstance(pending, list):
        pending.append(fields)
        return
    _write([fields])


def _write(rows):
    from apps.users.models import PermissionAuditLog

    for fields in rows:
        try:
            with transaction.atomic():
                PermissionAuditLog.objects.create(**fields)
        except Exception:
            logger.warning("Permission audit write failed: action=%s path=%s", fields.get("action"), fields.get("path"), exc_info=True)


class DeferredAuditMiddleware:
    """Flush queued permission-audit rows once the view transaction has ended."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        setattr(request, OUTBOX_ATTR, [])
        try:
            return self.get_response(request)
        finally:
            rows = getattr(request, OUTBOX_ATTR, None) or []
            setattr(request, OUTBOX_ATTR, None)
            if rows:
                _write(rows)
