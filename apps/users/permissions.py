import logging
from typing import Optional

from rest_framework.permissions import BasePermission

from apps.users.permission_registry import can_with_wildcard, is_public_endpoint, resolve_required_permission
from apps.users.permission_service import PermissionService

logger = logging.getLogger(__name__)


class RoleBasedAccessPermission(BasePermission):
    """Deny-by-default RBAC for API endpoints when STRICT_RBAC is enabled."""

    message = "You do not have permission to access this resource."

    def has_permission(self, request, view):
        path = str(getattr(request, "path", "") or "")
        method = str(getattr(request, "method", "GET") or "GET").upper()

        if is_public_endpoint(path):
            return True

        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return False

        if getattr(user, "is_superuser", False) or getattr(user, "is_owner", False):
            return True

        strict_mode = getattr(view, "rbac_strict", None)
        if strict_mode is None:
            from django.conf import settings

            strict_mode = bool(getattr(settings, "STRICT_RBAC", False))

        # In non-strict environments (dev/test), keep endpoints reachable while
        # still requiring authentication. Production runs with STRICT_RBAC=True.
        if not strict_mode:
            return True

        required_permission = resolve_required_permission(path=path, method=method)

        if required_permission is None:
            # Deny-by-default in strict mode, allow while strict mode is disabled.
            if strict_mode:
                self._log_denied(user, method, path, required_permission="UNMAPPED")
                return False
            return True

        granted = set(PermissionService.get_user_permissions(user))
        if can_with_wildcard(granted, required_permission):
            return True

        self._log_denied(user, method, path, required_permission=required_permission)
        return False

    @staticmethod
    def _log_denied(user, method: str, path: str, required_permission: Optional[str]):
        try:
            from apps.users.models import PermissionAuditLog

            PermissionAuditLog.objects.create(
                user=user,
                action="DENIED",
                method=method,
                path=path,
                required_permission=required_permission or "",
                details={"reason": "rbac_permission_missing"},
            )
        except Exception:
            logger.warning("RBAC denial log failed for %s %s", method, path, exc_info=True)
